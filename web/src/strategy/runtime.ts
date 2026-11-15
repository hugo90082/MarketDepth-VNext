import {ASSETS, type Asset} from '../../shared/model';
import {HOUR, MINUTE, NOTIONAL, priceFeatures, strategyDepth, type ClosedEpisode, type PriceBar} from '../../shared/strategy-v37';
import {advanceLedger, createLedger, LANES, laneRanges, type LaneInput, type Ledger, type Notice} from '../../shared/strategy-v37-ledger';
import type {StoredRow} from '../../shared/contract';
import {createBrowserAlertSoundPlayer, type AlertSoundPlayer} from '../monitor/alert-sound';
import {marketRuntime} from '../runtime/client';
import {loadCandles, loadRows, onMarketBlockSaved} from '../storage';
import {
 fetchVNextDays,
 fetchVNextFirstSpotTs,
 fetchVNextHistoryKind,
 groupSpotRowsToStoredRows,
 mapFutures1mToStoredCandles,
 type VNextDay,
 type VNextFutures1mRow,
 type VNextSpotRow,
} from '../vnext-adapter';
import {taipeiSpanStart, updateMarksFromPrices} from './replay-helpers';
import {claimSound, commitLedger, MAX_NOTICES, readLedger, recentNotices, resetLedger} from './store';

export type ResetHorizon = 'all' | number;
type View = {
 ledger: Ledger | null;
 notices: Notice[];
 toast: Notice[];
 error: string;
 sound: boolean;
 primed: boolean;
 capable: boolean | null;
 notional: number;
 resetting: boolean;
 catchingUp: boolean;
};
let view: View = {
 ledger:null, notices:[], toast:[], error:'', sound:false, primed:false, capable:null,
 notional:NOTIONAL, resetting:false, catchingUp:false,
};
const listeners = new Set<() => void>();
const SOUND_KEY = 'marketdepth-strategy-v37-sound';
const NOTIONAL_KEY = 'marketdepth-strategy-v37-n';
const BLOCK = 15 * MINUTE;
const ANCHOR = 15 * MINUTE;
const REMOTE_SPAN = 6 * HOUR;
let active = false, running = false, dirty = false, playing: AlertSoundPlayer | null = null;
let timer: ReturnType<typeof setTimeout> | undefined, poll: ReturnType<typeof setInterval> | undefined;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
let detach: (() => void)[] = [];
type Block = {rows: StoredRow[]; prices: [Asset, PriceBar[]][]};
const cache = new Map<number, Promise<Block>>();
const remoteBlocks = new Map<number, Block>();
const remoteFetchedSpans = new Set<number>();
const remoteFetchedF1Spans = new Set<number>();
const remoteInflight = new Map<number, Promise<void>>();
type ArchiveInfo = {fetchedAt: number; days: VNextDay[]; sealedBefore: number; earliestSpotTs: number | null; earliestF1Ts: number | null};
let archiveCache: ArchiveInfo = {fetchedAt: 0, days: [], sealedBefore: -Infinity, earliestSpotTs: null, earliestF1Ts: null};
let archivePromise: Promise<ArchiveInfo> | null = null;

function setRemoteBlock(base: number, block: Block) {
 if (remoteBlocks.has(base)) remoteBlocks.delete(base);
 remoteBlocks.set(base, block);
 while (remoteBlocks.size > 400) {
  remoteBlocks.delete(remoteBlocks.keys().next().value!);
 }
}

async function discoverArchive(force = false, needFirstSpot = true): Promise<ArchiveInfo> {
 const now = Date.now();
 if (!force && archiveCache.fetchedAt > 0 && now - archiveCache.fetchedAt < 5 * MINUTE && (!needFirstSpot || archiveCache.earliestSpotTs !== null)) {
  return archiveCache;
 }
 if (!force && archivePromise) {
  const existing = await archivePromise;
  if (!needFirstSpot || existing.earliestSpotTs !== null) return existing;
 }
 archivePromise = (async () => {
  const days = await fetchVNextDays();
  let sealedBefore = -Infinity;
  let earliestF1Ts: number | null = null;
  for (const d of days) {
   if (d.state.startsWith('sealed') || d.state === 'archive_verified') {
    sealedBefore = Math.max(sealedBefore, d.to);
   }
   if (earliestF1Ts === null || d.from < earliestF1Ts) earliestF1Ts = d.from;
  }
  let earliestSpotTs = force ? null : archiveCache.earliestSpotTs;
  if (needFirstSpot && earliestSpotTs === null && days.length) {
   earliestSpotTs = await fetchVNextFirstSpotTs(days, undefined, 'low');
  }
  archiveCache = {fetchedAt: Date.now(), days, sealedBefore, earliestSpotTs, earliestF1Ts};
  return archiveCache;
 })();
 try {
  return await archivePromise;
 } finally {
  archivePromise = null;
 }
}

function resolveEarliestStart(info: ArchiveInfo, target: number): number | null {
 if (info.earliestSpotTs === null) return null;
 const minAfterWarmup = info.earliestF1Ts !== null ? info.earliestF1Ts + 15 * HOUR : info.earliestSpotTs;
 const start = Math.ceil(Math.max(info.earliestSpotTs, minAfterWarmup) / ANCHOR) * ANCHOR;
 return Math.min(target, start);
}

function mergeBlock(local: Block, remote: Block | undefined): Block {
 if (!remote) return local;
 if (!local.rows.length && local.prices.every(([, bars]) => !bars.length)) return remote;
 const rowMap = new Map<number, StoredRow>();
 for (const r of remote.rows) rowMap.set(r.t, r);
 for (const r of local.rows) rowMap.set(r.t, r);
 const rows = [...rowMap.values()].sort((a, b) => a.t - b.t);
 const localPrices = new Map(local.prices);
 const remotePrices = new Map(remote.prices);
 const prices: [Asset, PriceBar[]][] = ASSETS.map(asset => {
  const map = new Map<number, PriceBar>();
  for (const b of remotePrices.get(asset) ?? []) map.set(b.t, b);
  for (const b of localPrices.get(asset) ?? []) map.set(b.t, b);
  return [asset, [...map.values()].sort((a, b) => a.t - b.t)];
 });
 return {rows, prices};
}

function blockCompleteForV37(block: Block, needSpot: boolean): boolean {
 const hasPrices = block.prices.every(([, bars]) => bars.length >= 15);
 if (!hasPrices) return false;
 if (!needSpot) return true;
 return block.rows.filter(r => r.cadence === MINUTE && r.d[0]?.some(a => a.some(([b, a2]) => b !== null && a2 !== null))).length >= 15;
}

async function ensureRemoteSpan(wStart: number, target: number, needSpot: boolean) {
 if (remoteFetchedSpans.has(wStart)) return;
 if (!needSpot && remoteFetchedF1Spans.has(wStart)) return;
 while (remoteInflight.has(wStart)) {
  await remoteInflight.get(wStart);
  if (remoteFetchedSpans.has(wStart)) return;
  if (!needSpot && remoteFetchedF1Spans.has(wStart)) return;
 }
 const job = (async () => {
  const wEnd = Math.min(target + MINUTE, wStart + REMOTE_SPAN);
  if (wEnd <= wStart) return;
  const needF1 = !remoteFetchedF1Spans.has(wStart);
  const priority = wStart < target - 6 * HOUR ? 'low' : 'high';
  const [spotRaw, f1Raw] = await Promise.all([
   needSpot ? fetchVNextHistoryKind<VNextSpotRow>('spot_depth', wStart, wEnd, {venue: 'binance', priority}) : Promise.resolve([] as VNextSpotRow[]),
   needF1 ? fetchVNextHistoryKind<VNextFutures1mRow>('futures_1m', wStart, wEnd, {priority}) : Promise.resolve([] as VNextFutures1mRow[]),
  ]);
  const storedRows = groupSpotRowsToStoredRows(spotRaw);
  const candles = mapFutures1mToStoredCandles(f1Raw);
  const rowsByBase = new Map<number, StoredRow[]>();
  for (const row of storedRows) {
   const base = Math.floor(row.t / BLOCK) * BLOCK;
   const list = rowsByBase.get(base) ?? [];
   list.push(row);
   rowsByBase.set(base, list);
  }
  const candlesByBase = new Map<number, Record<Asset, PriceBar[]>>();
  for (const c of candles) {
   if (c.interval !== MINUTE || !c.complete || !c.closed) continue;
   const base = Math.floor(c.t / BLOCK) * BLOCK;
   let byAsset = candlesByBase.get(base);
   if (!byAsset) {
    byAsset = {BTC: [], ETH: [], SOL: []};
    candlesByBase.set(base, byAsset);
   }
   byAsset[c.asset].push({t: c.t, o: c.o, h: c.h, l: c.l, c: c.c});
  }
  for (let b = wStart; b < wEnd; b += BLOCK) {
   const prev = remoteBlocks.get(b);
   const byAsset = candlesByBase.get(b);
   const nextPrices: [Asset, PriceBar[]][] = ASSETS.map(asset => [asset, byAsset?.[asset] ?? []]);
   const nextBlock: Block = {rows: rowsByBase.get(b) ?? prev?.rows ?? [], prices: byAsset ? nextPrices : (prev?.prices ?? ASSETS.map(a => [a, []]))};
   setRemoteBlock(b, prev ? mergeBlock(nextBlock, prev) : nextBlock);
  }
  if (wStart + REMOTE_SPAN <= Date.now() - 20 * MINUTE) {
   remoteFetchedF1Spans.add(wStart);
   if (needSpot) remoteFetchedSpans.add(wStart);
  }
 })();
 remoteInflight.set(wStart, job);
 try {await job;} finally {remoteInflight.delete(wStart);}
}

function publish(patch: Partial<View>) {
 view = {...view, ...patch};
 listeners.forEach(listener => listener());
}

function readBlock(base: number) {
 const old = cache.get(base);
 if (old) {
  cache.delete(base);
  cache.set(base, old);
  return old;
 }
 const end = base + BLOCK - 1;
 const value = Promise.all([
  loadRows(base, end),
  Promise.all(ASSETS.map(async asset => [asset, (await loadCandles(asset, base, end))
   .filter(bar => bar.interval === MINUTE && bar.complete && bar.closed && bar.source === 'binance-usdm')] as [Asset, PriceBar[]])),
 ]).then(([rows, prices]) => ({rows, prices}));
 cache.set(base, value);
 if (cache.size > 180) cache.delete(cache.keys().next().value!);
 void value.catch(() => {if (cache.get(base) === value) cache.delete(base);});
 return value;
}

async function marketData(ledger: Ledger, target: number) {
 const bases = new Set<number>();
 const minThrough = LANES.reduce((m, d) => Math.min(m, ledger.lanes[d.key].through ?? ledger.from), target);
 const ranges = LANES.flatMap(definition => laneRanges(ledger.lanes[definition.key], ledger.from, target));
 if (target - minThrough <= 6 * HOUR) {
  ranges.push({from:target - 30 * MINUTE, to:target});
 }
 for (const range of ranges) {
  for (let base = Math.floor(range.from / BLOCK) * BLOCK; base <= range.to; base += BLOCK) bases.add(base);
 }
 const ordered = [...bases].sort((a, b) => a - b);
 const localBlocks = new Map<number, Block>();
 for (let offset = 0; offset < ordered.length; offset += 12) {
  const slice = ordered.slice(offset, offset + 12);
  const batch = await Promise.all(slice.map(readBlock));
  for (let i = 0; i < slice.length; i++) localBlocks.set(slice[i], batch[i]);
 }
 // Fetch missing ranges on-demand from VNext backend aligned to Asia/Taipei days so one request never spans 2 sealed archives.
 const missingSpans = new Map<number, boolean>();
 for (const base of ordered) {
  if (base > target) continue;
  const needSpot = base + BLOCK > ledger.from;
  const merged = mergeBlock(localBlocks.get(base)!, remoteBlocks.get(base));
  if (!blockCompleteForV37(merged, needSpot)) {
   const wStart = taipeiSpanStart(base, REMOTE_SPAN);
   const fetched = needSpot ? remoteFetchedSpans.has(wStart) : (remoteFetchedSpans.has(wStart) || remoteFetchedF1Spans.has(wStart));
   if (!fetched) {
    missingSpans.set(wStart, (missingSpans.get(wStart) ?? false) || needSpot);
   }
  }
 }
 let advanceCap = target;
 for (const [wStart, needSpot] of [...missingSpans.entries()].sort((a, b) => a[0] - b[0])) {
  try {
   await ensureRemoteSpan(wStart, target, needSpot);
  } catch {
   // Never advance sealed history past an unfetched remote span on transient errors.
   advanceCap = Math.min(advanceCap, wStart - MINUTE);
   break;
  }
 }
 const rows = new Map<number, StoredRow>(), prices = {BTC:new Map(), ETH:new Map(), SOL:new Map()} as Record<Asset, Map<number, PriceBar>>;
 for (const base of ordered) {
  const block = mergeBlock(localBlocks.get(base)!, remoteBlocks.get(base));
  for (const row of block.rows) if (row.t <= target) rows.set(row.t, row);
  for (const [asset, bars] of block.prices) for (const bar of bars) if (bar.t <= target) prices[asset].set(bar.t, bar);
 }
 const features = {BTC:priceFeatures(prices.BTC), ETH:priceFeatures(prices.ETH), SOL:priceFeatures(prices.SOL)};
 const input = new Map<string, LaneInput>(LANES.map(definition => {
  const {asset, zone} = definition;
  return [definition.key, {bar:t => prices[asset].get(t), point:t => strategyDepth(rows.get(t), asset, zone), features:features[asset]}];
 }));
 return {input, advanceCap, prices};
}

function schedule(delay = 700) {
 if (!active || !marketRuntime.isLeader()) return;
 dirty = true;
 if (!timer && !running) timer = setTimeout(() => {timer = undefined; void run();}, delay);
}

async function reload(notices: Notice[] = []) {
 const [ledger, latest] = await Promise.all([readLedger(), recentNotices()]);
 if (!active || (ledger?.revision ?? 0) < (view.ledger?.revision ?? 0)) return;
 publish({ledger:ledger ?? null, notices:latest, error:'', capable:marketRuntime.strategyCapability()});
 if (notices.length) announce(notices);
}

function announce(notices: Notice[]) {
 const unread = notices.filter(notice => !notice.historical && Date.now() - notice.at <= 3 * MINUTE);
 if (!unread.length) return;
 clearTimeout(toastTimer);
 publish({toast:unread});
 toastTimer = setTimeout(() => publish({toast:[]}), 10000);
 if (!view.sound || !view.primed || !playing) return;
 for (const notice of unread) {
  void claimSound(notice.id).then(claimed => {
   if (!claimed || !active || !view.sound || !view.primed || !playing) return;
   const isOpen = notice.action === 'entry' || notice.action === 'add';
   const buySide = (notice.side === 1 && isOpen) || (notice.side === -1 && !isOpen);
   const direction = buySide ? 'direction-buy' : 'direction-sell';
   return playing.enqueue(notice.id, [direction]);
  }).catch(() => {});
 }
}

function fail() {
 if (active) publish({error:'策略帳本暫時無法讀寫，請確認瀏覽器儲存空間。'});
}

async function run() {
 const stamp = marketRuntime.collectorStamp();
 const current = () => active && marketRuntime.isCollector(stamp);
 if (!current() || running) return;
 running = true;
 dirty = false;
 let more = false;
 let retryDelay = 20;
 try {
  const target = Math.floor(Date.now() / MINUTE) * MINUTE - MINUTE;
  const stored = await readLedger();
  if (!current()) return;
  let archive: ArchiveInfo | null = null;
  try {archive = await discoverArchive(false, !stored);} catch (err) {
   if (!stored && err instanceof Error && /401|UNAUTHORIZED/i.test(err.message)) {
    return;
   }
  }
  if (!current()) return;
  if (!stored && !archive) {
   more = true;
   retryDelay = 2500;
   return;
  }
  const initialFrom = !stored ? (resolveEarliestStart(archive!, target) ?? target - 8 * HOUR) : target - 8 * HOUR;
  const ledger = stored ?? createLedger(target, initialFrom);
  const before = JSON.stringify(ledger);
  const sealedBefore = archive?.sealedBefore ?? -Infinity;

  const recordMap = new Map<string, ClosedEpisode>();
  const removeSet = new Set<string>();
  const allNotices: Notice[] = [];
  let blocked = false;
  let stepMore = false;
  let latestPrices: Record<Asset, Map<number, PriceBar>> | null = null;
  let lastStepTarget = target;

  for (let step = 0; step < 6; step++) {
   const {input, advanceCap, prices} = await marketData(ledger, target);
   if (!current()) return;
   latestPrices = prices;
   if (!stored && step === 0 && advanceCap < ledger.from) {
    more = true;
    retryDelay = 2500;
    return;
   }
   const stepTarget = Math.min(target, advanceCap);
   lastStepTarget = stepTarget;
   const result = advanceLedger(ledger, input, stepTarget, sealedBefore);
   for (const id of result.remove) {
    recordMap.delete(id);
    removeSet.add(id);
   }
   for (const rec of result.records) {
    recordMap.set(rec.id, rec);
   }
   allNotices.push(...result.notices);
   blocked = advanceCap < target;
   stepMore = result.more;
   if (!stepMore || blocked) break;
  }

  if (latestPrices) {
   const maxLaneThrough = LANES.reduce((m, d) => Math.max(m, ledger.lanes[d.key].through ?? -Infinity), -Infinity);
   const markCeiling = !stepMore && !blocked ? target : (maxLaneThrough > -Infinity ? maxLaneThrough : Math.min(lastStepTarget, ledger.from));
   updateMarksFromPrices(ledger, latestPrices, markCeiling, target);
  }

  more = stepMore || blocked;
  if (blocked && !stepMore) retryDelay = 2500;
  if (view.catchingUp !== more) publish({catchingUp: more});
  const records = [...recordMap.values()];
  const remove = [...removeSet];
  const notices = allNotices.length > MAX_NOTICES ? allNotices.slice(-MAX_NOTICES) : allNotices;
  if (stored && before === JSON.stringify(ledger) && !records.length && !remove.length && !notices.length) {
   if (view.error) publish({error:''});
   return;
  }
  const inserted = await commitLedger(ledger, records, remove, notices, stamp!.epoch, current);
  if (inserted === null) {more = true; return;}
  if (current()) marketRuntime.publish({type:'strategy-update', owner:stamp!.id, epoch:stamp!.epoch, notices:inserted});
 } catch {
  fail();
 } finally {
  running = false;
  if (active && view.catchingUp !== more) publish({catchingUp: more});
  if (more || dirty) schedule(more ? retryDelay : 700);
 }
}

async function enableAudio() {
 if (view.primed || !view.sound) return;
 try {
  playing ??= createBrowserAlertSoundPlayer();
  const audio = await playing.prime();
  if (active && audio.state === 'running') publish({primed:true});
 } catch {
  // Keep the enable control available after a browser blocks autoplay.
 }
}

function audioPreference() {
 try { return localStorage.getItem(SOUND_KEY) === '1'; } catch { return false; }
}

const validNotional = (value: number) => Number.isFinite(value) && value > 0;
function notionalPreference() {
 try {
  const value = Number(localStorage.getItem(NOTIONAL_KEY));
  return validNotional(value) ? value : NOTIONAL;
 } catch { return NOTIONAL; }
}

export const strategyRuntime = {
 snapshot: () => view,
 subscribe(listener: () => void) {listeners.add(listener); return () => {listeners.delete(listener);};},
 start() {
  if (active) return;
  active = true;
  publish({sound:audioPreference(), primed:false, notional:notionalPreference()});
  let owner = '';
  const changed = () => {
   const stamp = marketRuntime.collectorStamp(), key = stamp ? stamp.id + ':' + stamp.epoch : '';
   const capable = marketRuntime.strategyCapability();
   if (view.capable !== capable) publish({capable});
   if (key === owner) return;
   owner = key;
   cache.clear();
   void reload().catch(fail);
   schedule();
  };
  const preferenceChanged = (event: StorageEvent) => {
   if (event.key === NOTIONAL_KEY || event.key === null) publish({notional:notionalPreference()});
   if (event.key !== SOUND_KEY) return;
   const sound = audioPreference();
   publish({sound});
   if (!sound) playing?.stopAll();
  };
  detach = [onMarketBlockSaved(base => {cache.delete(base); schedule();}), marketRuntime.subscribe(changed),
   marketRuntime.events(message => {
    if (message.type === 'strategy-update') void reload(message.notices).catch(fail);
   })];
  const authResumed = () => {archiveCache.fetchedAt = 0; schedule(50);};
  document.addEventListener('pointerdown', enableAudio);
  window.addEventListener('storage', preferenceChanged);
  window.addEventListener('pageshow', changed);
  window.addEventListener('marketdepth-auth-resumed', authResumed);
  detach.push(() => {
   document.removeEventListener('pointerdown', enableAudio);
   window.removeEventListener('storage', preferenceChanged);
   window.removeEventListener('pageshow', changed);
   window.removeEventListener('marketdepth-auth-resumed', authResumed);
  });
  poll = setInterval(() => schedule(), 12000);
  changed();
  void reload().catch(fail);
  schedule();
 },
 stop() {
  active = false;
  detach.forEach(remove => remove());
  detach = [];
  clearTimeout(timer);
  timer = undefined;
  clearInterval(poll);
  clearTimeout(toastTimer);
  void playing?.destroy()?.catch(() => {});
  playing = null;
  cache.clear();
 },
 setNotional(value: number) {
  if (!validNotional(value) || value === view.notional) return view.notional;
  try {localStorage.setItem(NOTIONAL_KEY, String(value));} catch { /* Apply for the current tab. */ }
  publish({notional:value});
  return value;
 },
 async sound(enabled: boolean) {
  try {localStorage.setItem(SOUND_KEY, enabled ? '1' : '0');} catch { /* Current tab can still play. */ }
  publish({sound:enabled});
  if (!enabled) {playing?.stopAll(); return;}
  await enableAudio();
  if (view.primed) await playing?.preview('direction-buy');
 },
 async reset(horizon: ResetHorizon) {
  const stamp = marketRuntime.collectorStamp();
  const current = () => active && marketRuntime.isCollector(stamp);
  if (!current()) return false;
  publish({resetting:true, error:''});
  try {
   while (running) await new Promise(resolve => setTimeout(resolve, 60));
   if (!current()) return false;
   const target = Math.floor(Date.now() / MINUTE) * MINUTE - MINUTE;
   let from: number;
   if (horizon === 'all') {
    const info = await discoverArchive(true);
    from = resolveEarliestStart(info, target) ?? (target - 8 * HOUR);
   } else {
    from = horizon <= 0 ? target : target - horizon * HOUR;
   }
   const fresh = await resetLedger(target, from, stamp!.epoch, current);
   if (!fresh || !current()) return false;
   publish({ledger:fresh, notices:[], toast:[], catchingUp: target - from > 6 * HOUR});
   marketRuntime.publish({type:'strategy-update', owner:stamp!.id, epoch:stamp!.epoch, notices:[]});
   schedule(10);
   return true;
  } catch {
   fail();
   return false;
  } finally {
   if (active) publish({resetting:false});
  }
 },
};
