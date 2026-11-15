import assert from 'node:assert/strict';
import {test} from 'node:test';
import 'fake-indexeddb/auto';
import {advanceStrategy, emptyStrategy, HOUR, MINUTE, priceFeatures, remaining, STRATEGIES, strategyDepth,
 type DepthPoint, type PriceBar, type Strategy, type StrategyState} from '../shared/strategy-v37';
import {advanceLedger, createLedger, LANES, portfolioNets, summarizeAsset, type LaneInput} from '../shared/strategy-v37-ledger';
import {CONTRACT, emptyRow} from '../shared/contract';
import {claimSound, commitLedger, readHistory, readLedger} from '../src/strategy/store';

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
