import assert from 'node:assert/strict';
import {test} from 'node:test';
import 'fake-indexeddb/auto';
import {advanceStrategy, emptyStrategy, HOUR, MINUTE, priceFeatures, remaining, STRATEGIES, strategyDepth,
 type DepthPoint, type PriceBar, type Strategy, type StrategyState} from '../shared/strategy-v37';
import {advanceLedger, createLedger, LANES, portfolioNets, summarizeAsset, type LaneInput, type Notice} from '../shared/strategy-v37-ledger';
import {CONTRACT, emptyRow} from '../shared/contract';
import {claimSound, commitLedger, MAX_NOTICES, readHistory, readLedger, recentNotices, resetLedger} from '../src/strategy/store';
import {taipeiSpanStart, updateMarksFromPrices} from '../src/strategy/replay-helpers';
import {fetchVNextFirstSpotTs} from '../src/vnext-adapter';

const T = 20 * HOUR;
const long = STRATEGIES.find(s => s.asset === 'BTC' && s.side === 1 && s.add === 'A3')!;
const short = STRATEGIES.find(s => s.asset === long.asset && s.side === -1 && s.zone === long.zone && s.threshold === long.threshold)!;
const laneKey = long.asset + ':' + long.zone.split('-')[1];
const bar = (t: number, o = 100, l = o, h = o): PriceBar => ({t,o,h,l,c:o});
const point = (t: number, ratio: number, delay = 0, source = 'native'): DepthPoint => ({
 ratio, source, availableAt:t + MINUTE + delay, quality:'partial',
});
const near = (value: number, expected: number) => assert.ok(Math.abs(value - expected) < 1e-9, value + ' != ' + expected);
function started(strategy: Strategy, at = T - MINUTE) {
 const state = emptyStrategy();
 state.pending.push({kind:'entry', at, knownAt:at, signalAt:at - MINUTE});
 advanceStrategy(state, strategy, {bar:bar(at), depth:null, window:[], price:null});
 return state;
}
function step(state: StrategyState, t: number, ratio: number, delay = 0, price = bar(t)) {
 return advanceStrategy(state, long, {bar:price, depth:point(t, ratio, delay), window:[], price:null});
}

test('a minute exit cancels unfilled adds and a later reverse replaces a same-open trim', () => {
 const state = started(long);
 state.pending.push({kind:'add', at:T + 2 * MINUTE, knownAt:T, signalAt:T - MINUTE});
 step(state, T, 0, 1);
 assert.deepEqual(state.pending.map(action => action.kind), ['trim']);
 assert.equal(state.episode!.addLocked, true);
 step(state, T + MINUTE, -.30);
 assert.deepEqual(state.pending.map(action => action.kind), ['reverse']);
 const [round] = step(state, T + 2 * MINUTE, -.35, 0, bar(T + 2 * MINUTE, 99));
 assert.deepEqual(round.fills.map(fill => fill.kind), ['entry', 'reverse']);
 near(round.cash, -10.8);
 assert.equal(state.closedCount, 1);
 assert.equal(state.episode, null);
});

test('an earlier partial fill is retained and the residual is settled in one fee-adjusted episode', () => {
 const state = started(long);
 step(state, T, 0, 1);
 step(state, T + MINUTE, -.30, 1);
 assert.deepEqual(state.pending.map(action => action.kind), ['trim','reverse']);
 assert.deepEqual(step(state, T + 2 * MINUTE, -.32, 1, bar(T + 2 * MINUTE, 101)), []);
 assert.equal(remaining(state.episode), 250);
 near(state.episode!.cash, 6.8);
 const [closed] = step(state, T + 3 * MINUTE, -.31, 0, bar(T + 3 * MINUTE, 102));
 assert.deepEqual(closed.fills.map(fill => fill.amount), [1000,750,250]);
 near(closed.cash, 11.7);
 near(state.closedPnl, 11.7);
});

test('opening stop precedes expiry, expiry precedes scheduled adds, and stops only rearm on the 15-minute anchor', () => {
 const state = started(long, T - 12 * HOUR);
 state.pending.push({kind:'add', at:T, knownAt:T, signalAt:T - MINUTE});
 const [stop] = step(state, T, -.50, 0, bar(T, 90));
 assert.equal(stop.reason, 'stop');
 assert.equal(stop.fills.length, 2);
 assert.equal(state.stopped, true);
 step(state, T + MINUTE, -.50);
 assert.equal(state.stopped, true);
 step(state, T + 15 * MINUTE, -.50);
 assert.equal(state.stopped, false);
 const expired = started(long, T - 12 * HOUR);
 expired.pending.push({kind:'add', at:T, knownAt:T, signalAt:T - MINUTE});
 assert.equal(step(expired, T, .60)[0].reason, 'expiry');
 assert.equal(expired.episode, null);
});

test('ATR requires all 14 closed hours and one earlier close', () => {
 const bars = new Map<number,PriceBar>();
 for (let t = T - 14 * HOUR - MINUTE; t < T; t += MINUTE) bars.set(t, bar(t, 100, 99, 101));
 near(priceFeatures(bars)(T - MINUTE)!.atr, 200);
 assert.equal(priceFeatures(bars)(T - 2 * MINUTE), null);
 bars.delete(T - 5 * MINUTE);
 assert.equal(priceFeatures(bars)(T - MINUTE), null);
});

function setup() {
 const ledger = createLedger(T);
 for (const lane of Object.values(ledger.lanes)) lane.through = T - MINUTE;
 const index = LANES.find(lane => lane.key === laneKey)!.strategies.indexOf(long);
 return {ledger, lane:ledger.lanes[laneKey], index};
}
function inputs(missing = false, low = 100) {
 return new Map<string,LaneInput>(LANES.map(lane => [lane.key, {
  bar:t => t === T ? bar(t, 100, lane.key === laneKey ? low : 100) : undefined,
  point:t => missing && lane.key === laneKey ? null : point(t, .40),
  features:() => null,
 }]));
}

test('depth-gap price exit is provisional, then replay atomically replaces the same round', async () => {
 const {ledger, lane, index} = setup();
 lane.states[index] = started(long);
 lane.states[index].pending.push({kind:'reverse', at:T, knownAt:T, signalAt:T - MINUTE});
 const pending = advanceLedger(ledger, inputs(true, 90), T);
 assert.equal(pending.records.length, 1);
 assert.equal(pending.records[0].provisional, true);
 assert.equal(pending.records[0].reason, 'stop');
 assert.equal(lane.states[index].closedCount, 0);
 assert.equal(ledger.lanes['ETH:100'].through, T);
 assert.equal(portfolioNets(ledger).BTC, 0);
 assert.equal(pending.notices.length, 1);
 const saved = await commitLedger(ledger, pending.records, pending.remove, pending.notices, 100, () => true);
 assert.equal(saved?.length, 1);
 assert.equal((await readHistory(long.id)).rows[0].provisional, true);
 const loaded = (await readLedger())!;
 const stale = structuredClone(loaded);
 const recovered = advanceLedger(loaded, inputs(false, 90), T);
 assert.equal(recovered.records[0].reason, 'reverse');
 assert.equal(recovered.records[0].provisional, false);
 assert.equal(recovered.notices[0].kind, 'fill');
 assert.equal(recovered.notices[0].action, 'reverse');
 assert.equal(recovered.notices[0].provisional, false);
 await commitLedger(loaded, recovered.records, recovered.remove, recovered.notices, 101, () => true);
 assert.equal(await commitLedger(stale, [], [], [], 100, () => true), null);
 const history = (await readHistory(long.id)).rows;
 assert.equal(history.length, 1);
 assert.equal(history[0].provisional, false);
 near(history[0].cash, -.8);
 assert.equal((await readLedger())!.lanes[laneKey].states[index].closedCount, 1);
 const duplicate = advanceLedger(loaded, inputs(), T);
 assert.equal(duplicate.records.length + duplicate.notices.length, 0);
 assert.deepEqual((await Promise.all([claimSound('same-minute'), claimSound('same-minute')])).sort(), [false, true]);
});

test('opposite closures in the same minute both settle and both emit fill notices', () => {
 const {ledger, lane, index} = setup();
 const indexShort = LANES.find(lane => lane.key === laneKey)!.strategies.indexOf(short);
 lane.states[index] = started(long);
 lane.states[indexShort] = started(short);
 for (const state of [lane.states[index], lane.states[indexShort]]) {
  state.pending.push({kind:'reverse', at:T, knownAt:T, signalAt:T - MINUTE});
 }
 const result = advanceLedger(ledger, inputs(), T);
 assert.equal(result.records.length, 2);
 assert.equal(result.notices.length, 2);
 assert.ok(result.notices.every(notice => notice.kind === 'fill' && notice.action === 'reverse'));
 assert.equal(portfolioNets(ledger).BTC, 0);
});

test('a long recovery retains provisional history until replay has reached the original close', () => {
 const {ledger, lane, index} = setup();
 lane.states[index] = started(long);
 const stopAt = T + 250 * MINUTE, target = T + 320 * MINUTE;
 const series = (missing: boolean) => new Map<string,LaneInput>(LANES.map(definition => [definition.key, {
  bar:t => bar(t,100, t === stopAt ? 90 : 100),
  point:t => missing && definition.key === laneKey ? null : point(t, .4),
  features:() => null,
 }]));
 advanceLedger(ledger, series(true), target);
 const provisional = advanceLedger(ledger, series(true), target).records.find(record => record.strategyId === long.id);
 assert.equal(provisional?.closedAt, stopAt);
 assert.equal(provisional?.provisional, true);
 const firstBatch = advanceLedger(ledger, series(false), target);
 assert.equal(firstBatch.more, true);
 assert.equal(firstBatch.remove.length, 0);
 assert.equal(lane.review.length, 1);
 const completion = advanceLedger(ledger, series(false), target);
 assert.deepEqual(completion.remove, [provisional!.id]);
 assert.equal(completion.more, false);
 assert.ok(completion.notices.some(notice =>
  notice.kind === 'fill' && notice.action === 'stop' && notice.provisional === false && notice.fillAt === stopAt));
 assert.equal(completion.records.find(record => record.id === provisional!.id)?.provisional, false);
});

test('live 1m browser/recent/railway rows share unified depth source, while legacy-30s still isolates', () => {
 type DepthRow = NonNullable<Parameters<typeof strategyDepth>[0]>;
 const makeRow = (source: DepthRow['source'], feed?: 'vnext-1m' | 'legacy-30s'): DepthRow => {
  const row = emptyRow(T);
  for (let v = 0; v < row.d.length; v += 1) {
   for (let z = 0; z < row.d[v][0].length; z += 1) row.d[v][0][z] = [6, 4];
  }
  return {
   ...row,
   cadence: MINUTE,
   source,
   format: CONTRACT.datasetFormat,
   ...(feed ? {
    quality: {
     version: 'FORMAL_AVAILABLE_V2',
     books: [[{
      capturedAt: T + MINUTE,
      feed,
      bidBps: 750,
      askBps: 750,
      complete: [true, true, true, true, true],
      mode: 'ws',
     }]],
    },
   } : {}),
  };
 };
 assert.equal(strategyDepth(makeRow('browser', 'vnext-1m'), 'BTC', 0)?.source, 'vnext-1m');
 assert.equal(strategyDepth(makeRow('recent'), 'BTC', 0)?.source, 'vnext-1m');
 assert.equal(strategyDepth(makeRow('railway'), 'BTC', 0)?.source, 'vnext-1m');
 assert.notEqual(strategyDepth(makeRow('browser', 'legacy-30s'), 'BTC', 0)?.source, 'vnext-1m');
});

test('idle minutes with no fills emit zero notices and summarizeAsset splits realized vs unrealized PnL', () => {
 const {ledger, lane, index} = setup();
 lane.states[index] = started(long);
 const upInputs = new Map<string, LaneInput>(LANES.map(definition => [definition.key, {
  bar: t => t === T ? bar(t, 105, 105, 105) : undefined,
  point: t => point(t, .40),
  features: () => null,
 }]));
 const result = advanceLedger(ledger, upInputs, T);
 ledger.marks.BTC = {at: T, price: 105, fresh: true};
 assert.equal(result.notices.length, 0);
 const summary = summarizeAsset('BTC', ledger);
 near(summary.realized, -0.4);
 const {unrealized, total} = summary;
 assert.ok(unrealized !== null);
 near(unrealized, 49.6);
 assert.ok(total !== null);
 near(total, summary.realized + unrealized);
 assert.equal(summary.longNotional, 1000);
 assert.equal(summary.shortNotional, 0);
});

test('sealed historical gaps advance ledger in risk-only mode and rebuild 15-minute depth window afterward', () => {
 const {ledger, lane, index} = setup();
 lane.states[index] = started(long);
 const sealedInputs = new Map<string, LaneInput>(LANES.map(definition => [definition.key, {
  bar: t => t === T + 5 * MINUTE ? bar(t, 100, 80, 100) : bar(t, 100, 100, 100),
  point: t => t < T + 15 * MINUTE ? null : point(t, .40),
  features: () => null,
 }]));
 const res = advanceLedger(ledger, sealedInputs, T + 35 * MINUTE, T + 60 * MINUTE);
 assert.equal(lane.gap, null);
 assert.equal(lane.through, T + 35 * MINUTE);
 assert.equal(lane.window.length, 15);
 assert.equal(lane.window.every(Boolean), true);
 assert.equal(lane.states[index].closedCount, 1);
 assert.ok(res.records.some(record => record.reason === 'stop' && record.provisional === false));
});

test('commitLedger trims stored notices to MAX_NOTICES (150), removing the oldest', async () => {
 assert.equal(MAX_NOTICES, 150);
 const ledger = (await resetLedger(T, T, 200, () => true))!;
 const notices: Notice[] = Array.from({length: 160}, (_, i) => ({
  id: `notice-${i}`,
  kind: 'fill',
  at: T + i * MINUTE,
  fillAt: T + i * MINUTE,
  asset: 'BTC',
  strategyId: long.id,
  zone: long.zone,
  side: 1,
  threshold: long.threshold,
  entryRule: long.entry,
  addRule: long.add,
  action: 'entry',
  lot: 1,
  price: 100,
  amount: 1000,
  fee: 0.4,
  cash: -0.4,
  netBefore: 0,
  netAfter: 1000,
  provisional: false,
  historical: true,
 }));
 await commitLedger(ledger, [], [], notices, 200, () => true);
 const stored = await recentNotices(200);
 assert.equal(stored.length, 150);
 assert.equal(stored[0].fillAt, T + 159 * MINUTE);
 assert.equal(stored[stored.length - 1].fillAt, T + 10 * MINUTE);
});

test('fetchVNextFirstSpotTs skips zero-spot days, retries 503, and fails instead of skipping HTTP errors', async () => {
 const realFetch = globalThis.fetch;
 const calls: string[] = [];
 let attempt = 0;
 globalThis.fetch = (async (input: RequestInfo | URL) => {
  calls.push(String(input));
  attempt++;
  if (attempt === 1) return new Response(JSON.stringify({ok: false}), {status: 503, headers: {'retry-after': '1'}});
  return new Response(JSON.stringify({ok: true, data: [{t: 1790400000000}]}), {status: 200});
 }) as typeof fetch;
 try {
  const first = await fetchVNextFirstSpotTs([
   {day: '2026-09-25', state: 'sealed_remote', revision: 1, from: 1790265600000, to: 1790352000000, counts: {spot_depth: 0}},
   {day: '2026-09-26', state: 'sealed_remote', revision: 1, from: 1790352000000, to: 1790438400000, counts: {spot_depth: 3516}},
   {day: '2026-10-06', state: 'sealed_remote', revision: 1, from: 1791216000000, to: 1791302400000, counts: {spot_depth: 17280}},
  ]);
  assert.equal(first, 1790400000000);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(url => url.includes('from=1790352000000')));

  globalThis.fetch = (async () => new Response(JSON.stringify({ok: false}), {status: 500})) as typeof fetch;
  await assert.rejects(() => fetchVNextFirstSpotTs([
   {day: '2026-09-26', state: 'sealed_remote', revision: 1, from: 1790352000000, to: 1790438400000, counts: {spot_depth: 3516}},
   {day: '2026-10-06', state: 'sealed_remote', revision: 1, from: 1791216000000, to: 1791302400000, counts: {spot_depth: 17280}},
  ]), /HTTP 500/);
 } finally {
  globalThis.fetch = realFetch;
 }
});

test('taipeiSpanStart aligns 6h remote spans to Asia/Taipei days and never crosses midnight', () => {
 const SPAN = 6 * HOUR;
 const dayOfTaipei = (ms: number) => Math.floor((ms + 8 * HOUR) / (24 * HOUR));
 // 2026-11-11 19:59:00 Asia/Taipei = 2026-11-11T11:59:00Z
 const before20 = Date.UTC(2026, 10, 11, 11, 59, 0);
 // 2026-11-11 20:00:00 Asia/Taipei = 2026-11-11T12:00:00Z
 const at20 = Date.UTC(2026, 10, 11, 12, 0, 0);
 // 2026-11-11 23:45:00 Asia/Taipei = 2026-11-11T15:45:00Z
 const beforeMidnight = Date.UTC(2026, 10, 11, 15, 45, 0);
 // 2026-11-12 00:00:00 Asia/Taipei = 2026-11-11T16:00:00Z
 const atMidnight = Date.UTC(2026, 10, 11, 16, 0, 0);

 const spanBefore20 = taipeiSpanStart(before20, SPAN);
 assert.equal(spanBefore20, Date.UTC(2026, 10, 11, 10, 0, 0)); // 18:00 Taipei
 const spanAt20 = taipeiSpanStart(at20, SPAN);
 assert.equal(spanAt20, spanBefore20); // Still 18:00..24:00 Taipei (same day!)
 const spanBeforeMid = taipeiSpanStart(beforeMidnight, SPAN);
 assert.equal(spanBeforeMid, spanBefore20);
 assert.equal(dayOfTaipei(spanBeforeMid), dayOfTaipei(spanBeforeMid + SPAN - MINUTE));

 const spanAtMid = taipeiSpanStart(atMidnight, SPAN);
 assert.equal(spanAtMid, atMidnight); // 00:00..06:00 Taipei on 2026-11-12
 assert.equal(dayOfTaipei(spanAtMid), dayOfTaipei(spanBeforeMid) + 1);
 assert.equal(dayOfTaipei(spanAtMid), dayOfTaipei(spanAtMid + SPAN - MINUTE));
});

test('updateMarksFromPrices caps mark price at replay cursor until caught up to target', () => {
 const ledger = createLedger(T + 100 * HOUR, T);
 const replayAt = T + 4 * HOUR;
 const target = T + 96 * HOUR;
 const prices = {
  BTC: new Map<number, PriceBar>([[replayAt, bar(replayAt, 80000)], [target, bar(target, 64732.2)]]),
  ETH: new Map<number, PriceBar>([[replayAt, bar(replayAt, 2600)], [target, bar(target, 1950)]]),
  SOL: new Map<number, PriceBar>([[replayAt, bar(replayAt, 150)], [target, bar(target, 105)]]),
 };

 // Mid-replay: ceiling at 4h cursor ignores 96h target bar.
 updateMarksFromPrices(ledger, prices, replayAt, target);
 assert.equal(ledger.marks.BTC?.at, replayAt);
 assert.equal(ledger.marks.BTC?.price, 80000);
 assert.equal(ledger.marks.BTC?.fresh, false);

 // Caught up: ceiling at target marks to live bar with fresh=true.
 updateMarksFromPrices(ledger, prices, target, target);
 assert.equal(ledger.marks.BTC?.at, target);
 assert.equal(ledger.marks.BTC?.price, 64732.2);
 assert.equal(ledger.marks.BTC?.fresh, true);
});
