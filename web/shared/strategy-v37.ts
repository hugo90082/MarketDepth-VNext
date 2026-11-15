import catalog from './strategy-v37-catalog.json';
import type {StoredCandle, StoredRow} from './contract';
import {ASSETS, depth, ZONES, type Asset} from './model';

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const STRATEGY_VERSION = 'V37-1m-exit';
export const NOTIONAL = 1000;
const FEE = 0.0004;
const STOP = NOTIONAL * 0.09;
const HOLD = 12 * HOUR;
export const DEPTH_LIMITS = ZONES.map(([, upper]) => upper);

export type Strategy = {
 id: string; asset: Asset; zone: string; side: 1 | -1; threshold: number;
 entry: 'E1' | 'E2' | 'E6'; add: 'A0' | 'A2' | 'A3'; maxLots: 1 | 4;
};
export const STRATEGIES = catalog as Strategy[];
export type DepthPoint = {ratio: number; source: string; availableAt: number; quality: 'complete' | 'partial' | 'unknown'};
export type PriceBar = Pick<StoredCandle, 't' | 'o' | 'h' | 'l' | 'c' | 'observedAt'>;
export type PriceFeatures = {atr: number; r5: number; previous5: number; r15: number; range60: number; previousLow: number; previousHigh: number};
type Action = 'entry' | 'add' | 'trim' | 'reverse' | 'stop' | 'expiry';
type Pending = {kind: Exclude<Action, 'stop' | 'expiry'>; at: number; signalAt: number; knownAt: number};
export type Fill = {kind: Action; at: number; price: number; amount: number; fee: number; cash: number; lot: number; signalAt?: number; knownAt?: number};
type Lot = {price: number; remaining: number; sequence: number};
export type Episode = {id: string; startedAt: number; lots: Lot[]; fills: Fill[]; cash: number; addLocked: boolean; trimmed: boolean};
export type ClosedEpisode = Omit<Episode, 'lots' | 'addLocked' | 'trimmed'> & {
 strategyId: string; asset: Asset; closedAt: number; reason: 'reverse' | 'stop' | 'expiry'; provisional: boolean;
};
export type StrategyState = {episode: Episode | null; pending: Pending[]; stopped: boolean; closedPnl: number; closedCount: number};
export type MinuteInput = {
 bar: PriceBar; depth: DepthPoint | null; window: readonly (DepthPoint | null)[];
 price: PriceFeatures | null; riskOnly?: boolean; sealed?: boolean; reference?: boolean; entryDeadline?: number; lastDecision?: number;
};

export function emptyStrategy(): StrategyState {
 return {episode: null, pending: [], stopped: false, closedPnl: 0, closedCount: 0};
}

/** Use the same available amounts as the research graph. Missing outer shells
 * remain missing where the graph cannot supply a usable pair. */
export function strategyDepth(row: StoredRow | undefined, asset: Asset, zone: number): DepthPoint | null {
 if (!row || row.cadence !== MINUTE) return null;
 const pair = depth(row, asset, 'binance', Array.from({length: zone + 1}, (_, index) => index));
 if (pair.bid === null || pair.ask === null || pair.bid <= 0 || pair.ask <= 0 || pair.ratio === null) return null;
 const quality = row.quality?.books?.[0]?.[ASSETS.indexOf(asset)];
 const live1m = (row.source === 'browser' || row.source === 'recent' || row.source === 'railway') && quality?.feed !== 'legacy-30s';
 return {
  ratio: pair.ratio,
  source: live1m ? 'vnext-1m' : [row.source, quality?.mode ?? 'unknown', quality?.feed ?? 'unknown'].join(':'),
  availableAt: Math.max(row.t, row.a, quality?.capturedAt ?? 0),
  quality: quality ? quality.complete[zone] ? 'complete' : 'partial' : 'unknown',
 };
}

/** Uses the most recent completed hour, including the hour ending at this
 * minute's close. The first-bar fallback is only used for archive parity. */
export function priceFeatures(bars: ReadonlyMap<number, PriceBar>, referenceStart?: number) {
 const ranges = new Map<number, number | null>();
 function trueRange(hour: number) {
  if (ranges.has(hour)) return ranges.get(hour)!;
  let previous = bars.get(hour - MINUTE)?.c;
  if (previous === undefined && hour === referenceStart) previous = bars.get(hour)?.c;
  let high = -Infinity, low = Infinity, result: number | null = null;
  if (previous !== undefined) {
   let count = 0;
   for (let t = hour; t < hour + HOUR; t += MINUTE) {
    const bar = bars.get(t);
    if (!bar) break;
    high = Math.max(high, bar.h);
    low = Math.min(low, bar.l);
    count++;
   }
   if (count === 60) result = Math.max(high - low, Math.abs(high - previous), Math.abs(low - previous)) / previous * 10_000;
  }
  ranges.set(hour, result);
  return result;
 }
 const atrs = new Map<number, number | null>();
 return (t: number): PriceFeatures | null => {
  const end = Math.floor((t + MINUTE) / HOUR) * HOUR;
  if (!atrs.has(end)) {
   const hours = Array.from({length: 14}, (_, index) => trueRange(end - (14 - index) * HOUR));
   atrs.set(end, hours.every(n => n !== null) ? hours.reduce<number>((sum, n) => sum + n!, 0) / 14 : null);
  }
  const atr = atrs.get(end);
  if (atr == null) return null;
  const close = bars.get(t)?.c, close5 = bars.get(t - 5 * MINUTE)?.c;
  const close10 = bars.get(t - 10 * MINUTE)?.c, close15 = bars.get(t - 15 * MINUTE)?.c;
  if (close === undefined || close5 === undefined || close10 === undefined || close15 === undefined) return null;
  let low = Infinity, high = -Infinity, previousLow = Infinity, previousHigh = -Infinity;
  for (let offset = 0; offset < 60; offset++) {
   const value = bars.get(t - offset * MINUTE)?.c;
   if (value === undefined) return null;
   low = Math.min(low, value);
   high = Math.max(high, value);
   if (offset > 0 && offset <= 15) {
    previousLow = Math.min(previousLow, value);
    previousHigh = Math.max(previousHigh, value);
   }
  }
  return {atr, r5: (close / close5 - 1) * 10_000, previous5: (close5 / close10 - 1) * 10_000,
   r15: (close / close15 - 1) * 10_000, range60: (close - low) / Math.max(high - low, 1e-12), previousLow, previousHigh};
 };
}

export const remaining = (episode: Episode | null) => episode?.lots.reduce((sum, lot) => sum + lot.remaining, 0) ?? 0;
export function floating(episode: Episode | null, side: Strategy['side'], price: number, estimateFee = true) {
 return episode?.lots.reduce((sum, lot) => sum + lot.remaining * (side * (price / lot.price - 1) - (estimateFee ? FEE : 0)), 0) ?? 0;
}

function stopPrice(episode: Episode, side: Strategy['side']) {
 const slope = episode.lots.reduce((sum, lot) => sum + lot.remaining * side / lot.price, 0);
 return (-STOP - episode.cash + remaining(episode) * (side + FEE)) / slope;
}

function enter(state: StrategyState, strategy: Strategy, action: Pending, bar: PriceBar) {
 const episode = state.episode ??= {
  id: strategy.id + ':' + bar.t, startedAt: bar.t, lots: [], fills: [], cash: 0, addLocked: false, trimmed: false,
 };
 if (episode.lots.length >= strategy.maxLots) return;
 const lot = episode.lots.length + 1, fee = NOTIONAL * FEE;
 episode.lots.push({price: bar.o, remaining: NOTIONAL, sequence: lot});
 episode.cash -= fee;
 episode.fills.push({kind: action.kind, at: bar.t, price: bar.o, amount: NOTIONAL, fee, cash: -fee, lot,
  signalAt: action.signalAt, knownAt: action.knownAt});
}

function exit(state: StrategyState, strategy: Strategy, kind: 'trim' | ClosedEpisode['reason'],
 at: number, price: number, provisional: boolean, action?: Pending): ClosedEpisode | null {
 const episode = state.episode!;
 for (const lot of episode.lots) {
  const amount = lot.remaining * (kind === 'trim' ? 0.75 : 1);
  if (!amount) continue;
  const fee = amount * FEE, cash = amount * strategy.side * (price / lot.price - 1) - fee;
  lot.remaining -= amount;
  episode.cash += cash;
  episode.fills.push({kind, at, price, amount, fee, cash, lot: lot.sequence,
   ...(action ? {signalAt: action.signalAt, knownAt: action.knownAt} : {})});
 }
 if (kind === 'trim') {
  episode.trimmed = true;
  episode.addLocked = true;
  return null;
 }
 const record: ClosedEpisode = {id: episode.id, strategyId: strategy.id, asset: strategy.asset, startedAt: episode.startedAt,
  closedAt: at, reason: kind, fills: episode.fills, cash: episode.cash, provisional};
 if (!provisional) {
  state.closedPnl += record.cash;
  state.closedCount++;
 }
 state.episode = null;
 state.pending = [];
 state.stopped = kind === 'stop';
 return record;
}

function plan(kind: Pending['kind'], bar: PriceBar, point: DepthPoint): Pending {
 const knownAt = Math.max(bar.t + MINUTE, bar.observedAt ?? 0, point.availableAt);
 // B: choose the first allowed open. For a source that reports availability
 // beyond the archive's two-minute bound, do not use an earlier open.
 const at = Math.max(bar.t + MINUTE, Math.ceil(knownAt / MINUTE) * MINUTE);
 return {kind, at, signalAt: bar.t, knownAt};
}

function decision(state: StrategyState, strategy: Strategy, input: MinuteInput) {
 const {bar, depth: point, window, price, reference} = input;
 if (!point || input.riskOnly || (input.lastDecision !== undefined && bar.t > input.lastDecision)) return;
 const anchor = bar.t % (15 * MINUTE) === 0;
 const signed = strategy.side * point.ratio;
 const episode = state.episode;
 if (reference && state.pending.length) return;
 if (episode && (!reference || anchor)) {
  const full = state.pending.find(action => action.kind === 'reverse');
  const partial = state.pending.find(action => action.kind === 'trim');
  const kind = signed <= -0.30 ? 'reverse' : signed <= 0 && !episode.trimmed && !partial && !full ? 'trim' : null;
  if (kind && !full) {
   const action = plan(kind, bar, point);
   episode.addLocked = true;
   state.pending = state.pending.filter(pending =>
    (pending.kind !== 'add' || pending.at < action.knownAt) &&
    (kind !== 'reverse' || pending.kind !== 'trim' || pending.at < action.at));
   state.pending.push(action);
   return;
  }
 }
 if (!anchor || state.pending.length) return;
 if (!episode && state.stopped) {
  if (signed <= 0) state.stopped = false;
  return;
 }
 if (!price || signed < strategy.threshold || window.length !== 15) return;
 if (window[0]?.source !== point.source || (!reference && window.some(item => item?.source !== point.source))) return;
 if (window.filter(item => item && item.ratio * strategy.side >= strategy.threshold).length < 12) return;
 const {side} = strategy;
 const r5 = side * price.r5, previous5 = side * price.previous5, r15 = side * price.r15;
 const deceleration = r5 >= previous5 + 0.07 * price.atr;
 if (!episode) {
  if (input.entryDeadline !== undefined && bar.t >= input.entryDeadline) return;
  const extreme = side === 1 ? price.range60 <= 0.20 : price.range60 >= 0.80;
  const allowed = strategy.entry === 'E6' ? extreme && r5 >= 0 :
   r15 <= -0.20 * price.atr && (strategy.entry === 'E1' || deceleration);
  if (allowed) state.pending.push(plan('entry', bar, point));
  return;
 }
 if (episode.addLocked || episode.lots.length >= strategy.maxLots || strategy.add === 'A0') return;
 if (strategy.add === 'A2' ? !deceleration : r5 < -0.25 * price.atr) return;
 const moved = side * (bar.c / episode.lots.at(-1)!.price - 1) * 10_000;
 if (moved > -Math.max(25, Math.min(200, price.atr))) return;
 const adverseExtreme = side === 1 ? bar.c < price.previousLow : bar.c > price.previousHigh;
 if (r5 < -Math.max(5, 0.25 * price.atr) && (r5 < previous5 - 0.10 * price.atr || adverseExtreme)) return;
 state.pending.push(plan('add', bar, point));
}

/** One completed bar, in open → intraminute risk → close decision order. */
export function advanceStrategy(state: StrategyState, strategy: Strategy, input: MinuteInput): ClosedEpisode[] {
 const {bar, riskOnly = false} = input;
 const closed: ClosedEpisode[] = [];
 const close = (kind: 'trim' | ClosedEpisode['reason'], price: number, action?: Pending) => {
  const record = exit(state, strategy, kind, bar.t, price, riskOnly && !input.sealed, action);
  if (record) closed.push(record);
 };
 if (state.episode && state.episode.cash + floating(state.episode, strategy.side, bar.o) <= -STOP) {
  close('stop', bar.o);
  return closed;
 }
 if (state.episode && bar.t >= state.episode.startedAt + HOLD) close('expiry', bar.o);
 if (!riskOnly) {
  const due = state.pending.filter(action => action.at === bar.t);
  state.pending = state.pending.filter(action => action.at > bar.t);
  for (const action of due) {
   if (action.kind === 'entry' || action.kind === 'add') enter(state, strategy, action, bar);
   else if (state.episode) close(action.kind, bar.o, action);
  }
 }
 if (state.episode) {
  const trigger = stopPrice(state.episode, strategy.side);
  if (trigger > 0 && Number.isFinite(trigger) && (strategy.side === 1 ? bar.l <= trigger : bar.h >= trigger)) {
   close('stop', strategy.side === 1 ? Math.min(bar.o, trigger) : Math.max(bar.o, trigger));
   return closed;
  }
 }
 decision(state, strategy, input);
 return closed;
}
