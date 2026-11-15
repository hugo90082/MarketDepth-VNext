import {ASSETS, type Asset} from './model';
import {advanceStrategy, DEPTH_LIMITS, emptyStrategy, HOUR, MINUTE, remaining, STRATEGIES, STRATEGY_VERSION,
 type ClosedEpisode, type DepthPoint, type PriceBar, type PriceFeatures, type Strategy, type StrategyState} from './strategy-v37';

export const STEP_LIMIT = 180;
export const WARMUP = 15 * HOUR;
const ANCHOR = 15 * MINUTE;

export const LANES = ASSETS.flatMap(asset => DEPTH_LIMITS.map((limit, zone) => ({
 key: asset + ':' + limit, asset, zone,
 strategies: STRATEGIES.filter(strategy => strategy.asset === asset && strategy.zone === '0-' + limit),
})));
export type LaneDefinition = typeof LANES[number];
type Gap = {at: number; reason: 'price' | 'depth'; through: number; states: StrategyState[]; records: ClosedEpisode[]};
export type Lane = {
 through: number | null; states: StrategyState[]; window: (DepthPoint | null)[];
 gap: Gap | null; review: ClosedEpisode[]; quality: DepthPoint['quality'] | null;
};
export type Mark = {at: number; price: number; fresh: boolean};
type Nets = Record<Asset, number>;
export type Notice =
 | {id: string; kind: 'move'; at: number; asset: Asset; before: number; after: number; provisional: boolean}
 | {id: string; kind: 'replay'; at: number; from: number; through: number; before: Nets; after: Nets; closed: number; corrected: number};
type Replay = {from: number; through: number; before: Nets; closed: number; corrected: number};
export type Ledger = {
 version: typeof STRATEGY_VERSION; revision: number; from: number;
 lanes: Record<string, Lane>; marks: Partial<Record<Asset, Mark>>; replay: Replay | null;
 historyVersions: Record<string, number>;
};
export type LaneInput = {
 bar(t: number): PriceBar | undefined;
 point(t: number): DepthPoint | null;
 features(t: number): PriceFeatures | null;
};
type Move = {asset: Asset; at: number; delta: number; provisional: boolean};

export function createLedger(target: number): Ledger {
 return {version: STRATEGY_VERSION, revision: 0, from: target - 12 * HOUR,
  lanes: Object.fromEntries(LANES.map(lane => [lane.key, {
   through: null, states: lane.strategies.map(emptyStrategy), window: [], gap: null, review:[], quality: null,
  }])), marks: {}, replay: null, historyVersions: {}};
}

export const shownStates = (lane: Lane) => lane.gap?.states ?? lane.states;
export function portfolioNets(ledger: Ledger): Nets {
 const totals: Nets = {BTC: 0, ETH: 0, SOL: 0};
 for (const lane of LANES) {
  const states = shownStates(ledger.lanes[lane.key]);
  for (const [index, strategy] of lane.strategies.entries()) totals[lane.asset] += strategy.side * remaining(states[index].episode);
 }
 return totals;
}

function sum(states: StrategyState[], definitions: Strategy[]) {
 return states.reduce((total, state, index) => total + definitions[index].side * remaining(state.episode), 0);
}

export function laneRanges(lane: Lane, from: number, target: number) {
 if (lane.through === null) return [{from: from - WARMUP, to: target}];
 const ranges = [{from: lane.through + MINUTE - WARMUP, to: Math.min(target, lane.through + STEP_LIMIT * MINUTE)}];
 if (lane.gap) ranges.push({from: lane.gap.through + MINUTE, to: Math.min(target, lane.gap.through + STEP_LIMIT * MINUTE)});
 return ranges.filter(range => range.from <= range.to);
}

function advanceLane(lane: Lane, definition: LaneDefinition, input: LaneInput, from: number, target: number) {
 const oldGap = lane.gap;
 const records: ClosedEpisode[] = [], remove: string[] = [], moves: Move[] = [];
 const strategies = definition.strategies;
 let start = lane.through === null ? from : lane.through + MINUTE;
 if (lane.through === null) {
  start = Math.ceil(start / ANCHOR) * ANCHOR;
  for (; start <= target; start += ANCHOR) {
   const point = input.point(start);
   if (!point || !input.bar(start) || !input.features(start)) continue;
   const window = Array.from({length: 14}, (_, i) => input.point(start - (14 - i) * MINUTE));
   if (window.some(item => item?.source !== point.source)) continue;
   lane.window = window;
   break;
  }
  if (start > target) return {records, remove, moves, more:false, from:null, through:null, replay:false, corrected:0};
 }
 let next = start, steps = 0;
 for (; next <= target && steps < STEP_LIMIT; next += MINUTE, steps++) {
  const bar = input.bar(next), point = input.point(next);
  if (!bar || !point) break;
  const before = sum(lane.states, strategies);
  lane.window = [...lane.window.slice(-14), point];
  const features = next % ANCHOR === 0 ? input.features(next) : null;
  strategies.forEach((strategy, i) => records.push(...advanceStrategy(lane.states[i], strategy, {
   bar, depth:point, window:lane.window, price:features,
  })));
  const delta = sum(lane.states, strategies) - before;
  if (delta) moves.push({asset:definition.asset, at:next, delta, provisional:false});
  lane.through = next;
  lane.quality = point.quality;
 }
 const through = steps ? next - MINUTE : null;
 const resumed = !!oldGap && steps > 0;
 if (resumed) lane.review.push(...oldGap.records);
 let more = next <= target && steps === STEP_LIMIT;
 if (more || next > target) {
  lane.gap = null;
 } else if (lane.through !== null) {
  // Keep the confirmed state before the gap. The provisional copy runs price
  // risk only and can be discarded or reconciled once depth is available.
  const gap = !resumed && oldGap?.at === next ? oldGap : {
   at:next, reason:input.bar(next) ? 'depth' as const : 'price' as const, through:next - MINUTE,
   states:structuredClone(lane.states), records:[],
  };
  gap.reason = input.bar(next) ? 'depth' : 'price';
  let risk = gap.through + MINUTE, riskSteps = 0;
  for (; risk <= target && riskSteps < STEP_LIMIT; risk += MINUTE, riskSteps++) {
   const bar = input.bar(risk);
   if (!bar) break;
   const before = sum(gap.states, strategies);
   strategies.forEach((strategy, i) => {
    const closed = advanceStrategy(gap.states[i], strategy, {bar, depth:null, window:[], price:null, riskOnly:true});
    gap.records.push(...closed);
    records.push(...closed);
   });
   gap.through = risk;
   const delta = sum(gap.states, strategies) - before;
   if (delta) moves.push({asset:definition.asset, at:risk, delta, provisional:true});
  }
  lane.gap = gap;
  more ||= risk <= target && riskSteps === STEP_LIMIT;
 }
 let corrected = 0;
 const checkedThrough = lane.gap?.through ?? lane.through ?? -Infinity;
 lane.review = lane.review.filter(previous => {
  const updated = records.find(record => record.id === previous.id);
  if (!updated && checkedThrough < previous.closedAt) return true;
  remove.push(previous.id);
  if (!updated || updated.closedAt !== previous.closedAt || updated.cash !== previous.cash || updated.reason !== previous.reason) corrected++;
  return false;
 });
 return {records, remove, moves, more, from:steps ? start : null, through, replay:resumed || !!(steps && start < target),
  corrected};
}

/** Advance all independent depth intervals before deriving any net notice. */
export function advanceLedger(ledger: Ledger, inputs: ReadonlyMap<string, LaneInput>, target: number) {
 const before = portfolioNets(ledger);
 const results = LANES.map(definition => advanceLane(ledger.lanes[definition.key], definition, inputs.get(definition.key)!, ledger.from, target));
 const records = results.flatMap(result => result.records);
 const remove = results.flatMap(result => result.remove);
 const moves = results.flatMap(result => result.moves);
 const more = results.some(result => result.more);
 const notices: Notice[] = [];
 const progressed = results.filter(result => result.through !== null);
 const correction = results.reduce((total, result) => total + result.corrected, 0);
 if (progressed.length && (ledger.replay || progressed.some(result => result.replay))) {
  const first = Math.min(...progressed.map(result => result.from!));
  const through = Math.max(...progressed.map(result => result.through!));
  const replay = ledger.replay ??= {from:first, through, before, closed:0, corrected:0};
  replay.through = Math.max(replay.through, through);
  replay.closed += records.filter(record => !record.provisional).length;
  replay.corrected += correction;
 }
 if (ledger.replay && !more) {
  const replay = ledger.replay;
  notices.push({id:'replay:' + (ledger.revision + 1), kind:'replay', at:target + MINUTE, ...replay, after:portfolioNets(ledger)});
  ledger.replay = null;
 } else if (!ledger.replay) {
  const byMinute = new Map<string, Move>();
  for (const move of moves) {
   const key = move.asset + ':' + move.at;
   const old = byMinute.get(key);
   byMinute.set(key, {...move, delta:(old?.delta ?? 0) + move.delta, provisional:move.provisional || !!old?.provisional});
  }
  for (const move of [...byMinute.values()].sort((a, b) => a.at - b.at)) {
   const prior = before[move.asset];
   before[move.asset] += move.delta;
   if (!move.delta || move.at !== target) continue;
   notices.push({id:'move:' + move.asset + ':' + move.at, kind:'move', at:move.at + MINUTE,
    asset:move.asset, before:prior, after:before[move.asset],
    provisional:move.provisional || LANES.some(definition => {
     const lane = ledger.lanes[definition.key];
     return definition.asset === move.asset && (lane.through === null || !!lane.gap);
    })});
  }
 }
 return {records, remove, more, notices};
}
