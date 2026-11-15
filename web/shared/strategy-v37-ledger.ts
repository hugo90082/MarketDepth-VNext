import {ASSETS, type Asset} from './model';
import {advanceStrategy, DEPTH_LIMITS, emptyStrategy, floating, HOUR, MINUTE, remaining, STRATEGIES, STRATEGY_VERSION,
 type ClosedEpisode, type DepthPoint, type Fill, type PriceBar, type PriceFeatures, type Strategy, type StrategyState} from './strategy-v37';

export const STEP_LIMIT = 240;
export const WARMUP = 15 * HOUR;
const ANCHOR = 15 * MINUTE;

export const LANES = ASSETS.flatMap(asset => DEPTH_LIMITS.map((limit, zone) => ({
 key: asset + ':' + limit, asset, zone,
 strategies: STRATEGIES.filter(strategy => strategy.asset === asset && strategy.zone === '0-' + limit),
})));
export type LaneDefinition = typeof LANES[number];
type Gap = {at: number; reason: 'price' | 'depth'; through: number; states: StrategyState[]; records: ClosedEpisode[]};
export type Lane = {
 through: number | null; firstAt?: number | null; states: StrategyState[]; window: (DepthPoint | null)[];
 gap: Gap | null; review: ClosedEpisode[]; quality: DepthPoint['quality'] | null;
};
export type Mark = {at: number; price: number; fresh: boolean};
type Nets = Record<Asset, number>;

export type Notice = {
 id: string;
 kind: 'fill';
 at: number;
 fillAt: number;
 asset: Asset;
 strategyId: string;
 zone: string;
 side: 1 | -1;
 threshold: number;
 entryRule: Strategy['entry'];
 addRule: Strategy['add'];
 action: Fill['kind'];
 lot: number;
 price: number;
 amount: number;
 fee: number;
 cash: number;
 netBefore: number;
 netAfter: number;
 provisional: boolean;
 historical: boolean;
};

type Replay = {from: number; through: number; before: Nets; closed: number; corrected: number};
export type Ledger = {
 version: typeof STRATEGY_VERSION; revision: number; from: number; firstReadyAt?: number | null;
 lanes: Record<string, Lane>; marks: Partial<Record<Asset, Mark>>; replay: Replay | null;
 historyVersions: Record<string, number>;
};
export type LaneInput = {
 bar(t: number): PriceBar | undefined;
 point(t: number): DepthPoint | null;
 features(t: number): PriceFeatures | null;
};

type FillDraft = Omit<Notice, 'id' | 'kind' | 'netBefore' | 'netAfter' | 'historical'> & {delta: number; seq: number};

export function createLedger(target: number, from = target - 8 * HOUR): Ledger {
 const alignedFrom = Math.floor(from / MINUTE) * MINUTE;
 return {version: STRATEGY_VERSION, revision: 0, from: alignedFrom, firstReadyAt: null,
  lanes: Object.fromEntries(LANES.map(lane => [lane.key, {
   through: null, firstAt: null, states: lane.strategies.map(emptyStrategy), window: [], gap: null, review:[], quality: null,
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

export type AssetPnlSummary = {
 asset: Asset;
 net: number;
 longNotional: number;
 shortNotional: number;
 longCount: number;
 shortCount: number;
 realized: number;
 unrealized: number | null;
 total: number | null;
 markAt: number | null;
 markPrice: number | null;
 markFresh: boolean;
 startedLanes: number;
 availableLanes: number;
 confirmedThrough: number | null;
 firstReadyAt: number | null;
 oldestGap: {at: number; reason: 'price' | 'depth'} | null;
};

export function summarizeAsset(asset: Asset, ledger: Ledger | null): AssetPnlSummary {
 const definitions = LANES.filter(lane => lane.asset === asset);
 if (!ledger) {
  return {
   asset, net: 0, longNotional: 0, shortNotional: 0, longCount: 0, shortCount: 0,
   realized: 0, unrealized: null, total: null, markAt: null, markPrice: null, markFresh: false,
   startedLanes: 0, availableLanes: 0, confirmedThrough: null, firstReadyAt: null, oldestGap: null,
  };
 }
 const mark = ledger.marks[asset];
 let longNotional = 0, shortNotional = 0, longCount = 0, shortCount = 0;
 let realized = 0, unrealizedSum = 0, unrealizedKnown = true;
 let hasOpen = false, startedLanes = 0, availableLanes = 0;
 let confirmedThrough: number | null = null;
 let firstReadyAt: number | null = null;
 let oldestGap: {at: number; reason: 'price' | 'depth'} | null = null;

 for (const definition of definitions) {
  const lane = ledger.lanes[definition.key];
  if (lane.through !== null) {
   startedLanes++;
   if (!lane.gap) availableLanes++;
   confirmedThrough = confirmedThrough === null ? lane.through : Math.min(confirmedThrough, lane.through);
   const f = lane.firstAt ?? null;
   if (f !== null) firstReadyAt = firstReadyAt === null ? f : Math.min(firstReadyAt, f);
  }
  if (lane.gap && (!oldestGap || lane.gap.at < oldestGap.at)) {
   oldestGap = {at: lane.gap.at, reason: lane.gap.reason};
  }
  const states = shownStates(lane);
  const confirmed = lane.states;
  for (const [index, strategy] of definition.strategies.entries()) {
   const shown = states[index];
   realized += confirmed[index].closedPnl;
   if (!shown.episode) continue;
   hasOpen = true;
   const openCash = shown.episode.cash;
   realized += openCash;
   const rem = remaining(shown.episode);
   if (rem > 0) {
    if (strategy.side === 1) { longNotional += rem; longCount++; }
    else { shortNotional += rem; shortCount++; }
   }
   if (mark) {
    unrealizedSum += floating(shown.episode, strategy.side, mark.price);
   } else {
    unrealizedKnown = false;
   }
  }
 }
 const unrealized = startedLanes === 0 ? null : !hasOpen ? 0 : unrealizedKnown ? unrealizedSum : null;
 const total = startedLanes === 0 ? null : unrealized !== null ? realized + unrealized : realized;
 return {
  asset,
  net: longNotional - shortNotional,
  longNotional,
  shortNotional,
  longCount,
  shortCount,
  realized,
  unrealized,
  total,
  markAt: mark?.at ?? null,
  markPrice: mark?.price ?? null,
  markFresh: !!mark?.fresh,
  startedLanes,
  availableLanes,
  confirmedThrough,
  firstReadyAt: firstReadyAt ?? ledger.firstReadyAt ?? null,
  oldestGap,
 };
}

export function laneRanges(lane: Lane, from: number, target: number) {
 if (lane.through === null) return [{from: from - WARMUP, to: Math.min(target, from + STEP_LIMIT * MINUTE)}];
 const ranges = [{from: lane.through + MINUTE - WARMUP, to: Math.min(target, lane.through + STEP_LIMIT * MINUTE)}];
 if (lane.gap) ranges.push({from: lane.gap.through + MINUTE, to: Math.min(target, lane.gap.through + STEP_LIMIT * MINUTE)});
 return ranges.filter(range => range.from <= range.to);
}

function stepStrategyWithFills(
 state: StrategyState,
 strategy: Strategy,
 zone: string,
 bar: PriceBar,
 input: {depth: DepthPoint | null; window: readonly (DepthPoint | null)[]; price: PriceFeatures | null; riskOnly?: boolean; sealed?: boolean},
 provisional: boolean,
 seqCounter: {n: number},
): {closed: ClosedEpisode[]; drafts: FillDraft[]} {
 const prevEpId = state.episode?.id ?? null;
 const prevLen = state.episode?.fills.length ?? 0;
 const closed = advanceStrategy(state, strategy, {bar, ...input});
 const emitted: Fill[] = [];
 if (closed.length) {
  for (const ep of closed) {
   const tail = prevEpId === ep.id ? ep.fills.slice(prevLen) : ep.fills;
   for (const f of tail) if (f.at === bar.t) emitted.push(f);
  }
 }
 if (state.episode) {
  const tail = prevEpId === state.episode.id ? state.episode.fills.slice(prevLen) : state.episode.fills;
  for (const f of tail) if (f.at === bar.t) emitted.push(f);
 }
 if (!emitted.length) return {closed, drafts: []};

 // Aggregate multi-lot exits occurring on the same bar & kind into one clear notice per action.
 const grouped = new Map<string, Fill[]>();
 for (const f of emitted) {
  const key = f.at + ':' + f.kind;
  const list = grouped.get(key) ?? [];
  list.push(f);
  grouped.set(key, list);
 }
 const drafts: FillDraft[] = [];
 for (const fills of grouped.values()) {
  const first = fills[0];
  const amount = fills.reduce((s, f) => s + f.amount, 0);
  const fee = fills.reduce((s, f) => s + f.fee, 0);
  const cash = fills.reduce((s, f) => s + f.cash, 0);
  const isEntryOrAdd = first.kind === 'entry' || first.kind === 'add';
  const lot = isEntryOrAdd ? first.lot : fills.length;
  drafts.push({
   seq: seqCounter.n++,
   at: first.at + MINUTE,
   fillAt: first.at,
   asset: strategy.asset,
   strategyId: strategy.id,
   zone,
   side: strategy.side,
   threshold: strategy.threshold,
   entryRule: strategy.entry,
   addRule: strategy.add,
   action: first.kind,
   lot,
   price: first.price,
   amount,
   fee,
   cash,
   delta: strategy.side * (isEntryOrAdd ? amount : -amount),
   provisional,
  });
 }
 return {closed, drafts};
}

function advanceLane(lane: Lane, definition: LaneDefinition, input: LaneInput, from: number, target: number, sealedBefore: number, seqCounter: {n: number}) {
 const oldGap = lane.gap;
 const records: ClosedEpisode[] = [], remove: string[] = [], drafts: FillDraft[] = [];
 const strategies = definition.strategies;
 const zoneLabel = definition.key.split(':')[1] ? '0-' + definition.key.split(':')[1] : '';
 let start = lane.through === null ? from : lane.through + MINUTE;
 if (lane.through === null) {
  const probeLimit = Math.min(target, from + STEP_LIMIT * MINUTE);
  start = Math.ceil(start / ANCHOR) * ANCHOR;
  for (; start <= probeLimit; start += ANCHOR) {
   const point = input.point(start);
   if (!point || !input.bar(start) || !input.features(start)) continue;
   const window = Array.from({length: 14}, (_, i) => input.point(start - (14 - i) * MINUTE));
   if (window.some(item => item?.source !== point.source)) continue;
   lane.window = window;
   lane.firstAt ??= start;
   break;
  }
  if (start > probeLimit) {
   if (probeLimit < target && probeLimit < sealedBefore) {
    lane.through = probeLimit;
    return {records, remove, drafts, more:true, from:null, through:probeLimit, replay:false, corrected:0};
   }
   return {records, remove, drafts, more:false, from:null, through:null, replay:false, corrected:0};
  }
 }
 let next = start, steps = 0;
 for (; next <= target && steps < STEP_LIMIT; next += MINUTE, steps++) {
  const bar = input.bar(next), point = input.point(next);
  if (!bar || !point) {
   if (next < sealedBefore) {
    lane.window = [];
    if (bar) {
     strategies.forEach((strategy, i) => {
      const res = stepStrategyWithFills(lane.states[i], strategy, zoneLabel, bar, {
       depth: null, window: [], price: null, riskOnly: true, sealed: true,
      }, false, seqCounter);
      records.push(...res.closed);
      drafts.push(...res.drafts);
     });
    }
    lane.through = next;
    continue;
   }
   break;
  }
  lane.window = [...lane.window.slice(-14), point];
  const features = next % ANCHOR === 0 ? input.features(next) : null;
  strategies.forEach((strategy, i) => {
   const res = stepStrategyWithFills(lane.states[i], strategy, zoneLabel, bar, {
    depth: point, window: lane.window, price: features,
   }, false, seqCounter);
   records.push(...res.closed);
   drafts.push(...res.drafts);
  });
  lane.through = next;
  lane.firstAt ??= next;
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
   strategies.forEach((strategy, i) => {
    const res = stepStrategyWithFills(gap.states[i], strategy, zoneLabel, bar, {
     depth: null, window: [], price: null, riskOnly: true,
    }, true, seqCounter);
    gap.records.push(...res.closed);
    records.push(...res.closed);
    drafts.push(...res.drafts);
   });
   gap.through = risk;
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
 return {records, remove, drafts, more, from:steps ? start : null, through, replay:resumed || !!(steps && start < target),
  corrected};
}

/** Advance all independent depth intervals and emit only actual fill notices. */
export function advanceLedger(ledger: Ledger, inputs: ReadonlyMap<string, LaneInput>, target: number, sealedBefore = -Infinity) {
 const before = portfolioNets(ledger);
 const seqCounter = {n: 0};
 const results = LANES.map(definition => advanceLane(ledger.lanes[definition.key], definition, inputs.get(definition.key)!, ledger.from, target, sealedBefore, seqCounter));
 const records = results.flatMap(result => result.records);
 const remove = results.flatMap(result => result.remove);
 const allDrafts = results.flatMap(result => result.drafts).sort((a, b) => a.fillAt - b.fillAt || a.seq - b.seq);
 const more = results.some(result => result.more);

 for (const definition of LANES) {
  const f = ledger.lanes[definition.key].firstAt ?? null;
  if (f !== null && (ledger.firstReadyAt == null || f < ledger.firstReadyAt)) {
   ledger.firstReadyAt = f;
  }
 }

 const running = {...before};
 // Before was evaluated AFTER advanceLane mutated states, wait—capture pre-step net BEFORE advanceLane!
 // Actually `before` WAS captured on line 345 BEFORE `results = LANES.map(...)`!
 const notices: Notice[] = [];
 for (const draft of allDrafts) {
  const netBefore = running[draft.asset];
  const netAfter = netBefore + draft.delta;
  running[draft.asset] = netAfter;
  notices.push({
   id: `fill:${draft.strategyId}:${draft.fillAt}:${draft.action}:${draft.provisional ? 'p' : 'c'}`,
   kind: 'fill',
   at: draft.at,
   fillAt: draft.fillAt,
   asset: draft.asset,
   strategyId: draft.strategyId,
   zone: draft.zone,
   side: draft.side,
   threshold: draft.threshold,
   entryRule: draft.entryRule,
   addRule: draft.addRule,
   action: draft.action,
   lot: draft.lot,
   price: draft.price,
   amount: draft.amount,
   fee: draft.fee,
   cash: draft.cash,
   netBefore,
   netAfter,
   provisional: draft.provisional,
   historical: draft.fillAt < target - 2 * MINUTE,
  });
 }

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
  ledger.replay = null;
 }
 return {records, remove, more, notices};
}
