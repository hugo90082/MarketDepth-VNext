import assert from 'node:assert/strict';
import {createReadStream, readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createGunzip} from 'node:zlib';
import {createInterface} from 'node:readline';
import {ASSETS} from '../shared/model';
import {advanceStrategy, emptyStrategy, floating, HOUR, MINUTE, priceFeatures, STRATEGIES,
 type DepthPoint, type Fill, type PriceBar} from '../shared/strategy-v37';

const [rawPath, statisticsPath, fillsPath, baselinePath] = process.argv.slice(2);
if (!rawPath || !statisticsPath || !fillsPath) throw new Error('Pass the verified raw gzip, original strategy CSV and original fill CSV.');
const csv = (path: string) => {
 const [header, ...rows] = readFileSync(path, 'utf8').trim().replace(/^\uFEFF/, '').split(/\r?\n/);
 return rows.map(row => Object.fromEntries(header.split(',').map((key, i) => [key, row.split(',')[i]])));
};
const raw: any[] = [];
const hash = createHash('sha256');
const compressed = createReadStream(rawPath);
compressed.on('data', value => hash.update(value));
for await (const line of createInterface({input: compressed.pipe(createGunzip())})) raw.push(JSON.parse(line));
assert.equal(hash.digest('hex'), '45df890c67dcf248630b1914e63b4a930d554cd1b79bbe008a6ae90cbd93d0eb');
assert.equal(raw.length, 36828);
const start = raw[0].t as number, end = raw.at(-1).t as number;
assert.ok(raw.every((row, i) => row.t === start + i * MINUTE));
assert.equal(new Set(STRATEGIES.map(item => item.id)).size, 108);
const reference = new Map(csv(statisticsPath).map(row => [row.fixed_id, row]));
const referenceFills = csv(fillsPath);
const near = (actual: number, expected: number, label: string) => assert.ok(Math.abs(actual - expected) < 1e-6, label + ' ' + actual + ' != ' + expected);
const action = {entry:1, add:2, trim:3, reverse:4, expiry:4, stop:6} as const;
const prices = Object.fromEntries(ASSETS.map(asset => [asset, new Map<number, PriceBar>(raw.map(row => {
 const candle = row.price[asset];
 return [row.t, {t:row.t, o:candle.open, h:candle.high, l:candle.low, c:candle.close,
  observedAt:Math.max(row.decision_not_before_ms ?? 0, row.price_available_ms ?? 0)}];
}))])) as Record<typeof ASSETS[number], Map<number, PriceBar>>;
const points = new Map<string, (DepthPoint | null)[]>();
for (const {asset, zone} of STRATEGIES) {
 const key = asset + ':' + zone;
 if (points.has(key)) continue;
 let previous = '', segment = 0;
 points.set(key, raw.map(row => {
  if (row.depth_source !== previous) {previous = row.depth_source; segment++;}
  const pair = row.binance[asset][zone];
  return row.binance_valid && pair.bid_usd > 0 && pair.ask_usd > 0 ? {
   ratio:(pair.bid_usd - pair.ask_usd) / (pair.bid_usd + pair.ask_usd), source:previous + ':' + segment,
   availableAt:row.depth_available_ms ?? row.t, quality:'unknown',
  } : null;
 }));
}
for (const legacy of [true, false]) {
 const equity = new Float64Array(raw.length), digest = createHash('sha256');
 let fills = 0, rounds = 0, stopCount = 0, total = 0, fees = 0;
 const baselineFills: (Fill & {strategyId:string})[] = [];
 const features = Object.fromEntries(ASSETS.map(asset => {
  const feature = priceFeatures(prices[asset], start);
  return [asset, raw.map(row => row.t % (15 * MINUTE) === 0 ? feature(row.t) : null)];
 }));
 const perStrategy = [];
 for (const strategy of STRATEGIES) {
  const data = points.get(strategy.asset + ':' + strategy.zone)!;
  const state = emptyStrategy();
  const ledger: Fill[] = [];
  let peak = 0, drawdown = 0, stops = 0;
  for (let i = 0; i < raw.length; i++) {
   const bar = prices[strategy.asset].get(start + i * MINUTE)!;
   const completed = advanceStrategy(state, strategy, {
    bar, depth:data[i], window:i >= 14 && bar.t % (15 * MINUTE) === 0 ? data.slice(i - 14, i + 1) : [],
    price:features[strategy.asset][i], reference:legacy, entryDeadline:end - (12 * HOUR + 3 * MINUTE),
    lastDecision:end - 3 * MINUTE,
   });
   for (const round of completed) {
    ledger.push(...round.fills);
    if (round.reason === 'stop') stops++;
    assert.ok(round.closedAt - round.startedAt <= 12 * HOUR);
   }
   const mark = state.closedPnl + (state.episode?.cash ?? 0) + floating(state.episode, strategy.side, bar.c, false);
   equity[i] += mark;
   peak = Math.max(peak, mark);
   drawdown = Math.max(drawdown, peak - mark);
  }
  assert.equal(state.episode, null, strategy.id);
  const paid = ledger.reduce((sum, fill) => sum + fill.fee, 0);
  if (legacy) {
   const expected = reference.get(strategy.id)!;
   assert.equal(+expected.threshold, strategy.side * strategy.threshold);
   assert.equal(expected.entry_code, strategy.entry);
   assert.equal(expected.add_code, strategy.add);
   near(state.closedPnl, +expected.net_usd, strategy.id + ' pnl');
   near(drawdown, +expected.max_dd_usd, strategy.id + ' drawdown');
   near(paid, +expected.fee_usd, strategy.id + ' fees');
   assert.equal(state.closedCount, +expected.episodes, strategy.id);
   const expectedFills = referenceFills.filter(row => row.fixed_id === strategy.id);
   assert.equal(ledger.length, expectedFills.length, strategy.id);
   ledger.forEach((fill, i) => {
    const expected = expectedFills[i];
    assert.equal((fill.at - start) / MINUTE, +expected.i, strategy.id);
    assert.equal(action[fill.kind], +expected.action, strategy.id);
    near(fill.price, +expected.fill_price, strategy.id + ' fill');
    near(fill.amount, +expected.notional_usd, strategy.id + ' amount');
    near(fill.fee, +expected.fee_usd, strategy.id + ' fill fee');
    near(fill.cash, (fill.kind === 'entry' || fill.kind === 'add' ? -1 : 1) * +expected.cashflow_bps4k * .4, strategy.id + ' cash');
   });
  }
  fills += ledger.length;
  rounds += state.closedCount;
  stopCount += stops;
  total += state.closedPnl;
  fees += paid;
  perStrategy.push({id:strategy.id, pnl:state.closedPnl, drawdown, fees:paid, rounds:state.closedCount, fills:ledger.length});
  digest.update(JSON.stringify([strategy.id, ledger]));
  if (!legacy && baselinePath) baselineFills.push(...ledger.map(fill => ({strategyId:strategy.id, ...fill})));
 }
 let high = 0, drawdown = 0;
 for (const mark of equity) {high = Math.max(high, mark); drawdown = Math.max(drawdown, high - mark);}
 if (legacy) {
  assert.equal(fills, 2394);
  near(total, 4408.334611462214, 'V37 archived pnl');
  near(drawdown, 1234.4380677084332, 'V37 archived drawdown');
 } else {
  assert.equal(fills, 2473);
  assert.equal(rounds, 858);
  near(total, 4335.387899943034, 'one-minute pnl');
  near(drawdown, 1193.854577528913, 'one-minute drawdown');
 }
 const summary = {mode:legacy ? 'archive-15m' : 'exit-1m', strategies:STRATEGIES.length, fills, rounds, stops:stopCount,
  pnl:total, drawdown, fees, fillDigest:digest.digest('hex')};
 if (!legacy) assert.equal(summary.fillDigest, 'bb27f349426637c195031fea4f95a4f085fd423e51b1e21f70d77edd9028eba7');
 console.log(JSON.stringify(summary));
 if (!legacy && process.env.V37_REPLAY_DETAILS === '1') console.log(JSON.stringify(perStrategy));
 if (!legacy && baselinePath) writeFileSync(baselinePath, JSON.stringify({summary, perStrategy, fills:baselineFills}, null, 2) + '\n');
}
