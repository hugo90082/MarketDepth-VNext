import {ASSETS, type Asset} from '../../shared/model';
import {MINUTE, NOTIONAL, priceFeatures, strategyDepth, type PriceBar} from '../../shared/strategy-v37';
import {advanceLedger, createLedger, LANES, laneRanges, type LaneInput, type Ledger, type Notice} from '../../shared/strategy-v37-ledger';
import type {StoredRow} from '../../shared/contract';
import {createBrowserAlertSoundPlayer, type AlertSoundPlayer} from '../monitor/alert-sound';
import {marketRuntime} from '../runtime/client';
import {loadCandles, loadRows, onMarketBlockSaved} from '../storage';
import {claimSound, commitLedger, readLedger, recentNotices} from './store';

type View = {ledger: Ledger | null; notices: Notice[]; toast: Notice[]; error: string; sound: boolean; primed: boolean; capable: boolean | null; notional: number};
let view: View = {ledger:null, notices:[], toast:[], error:'', sound:false, primed:false, capable:null, notional:NOTIONAL};
const listeners = new Set<() => void>();
const SOUND_KEY = 'marketdepth-strategy-v37-sound';
const NOTIONAL_KEY = 'marketdepth-strategy-v37-n';
const BLOCK = 15 * MINUTE;
let active = false, running = false, dirty = false, playing: AlertSoundPlayer | null = null;
let timer: ReturnType<typeof setTimeout> | undefined, poll: ReturnType<typeof setInterval> | undefined;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
let detach: (() => void)[] = [];
type Block = {rows: StoredRow[]; prices: [Asset, PriceBar[]][]};
const cache = new Map<number, Promise<Block>>();

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
 for (const range of [...LANES.flatMap(definition => laneRanges(ledger.lanes[definition.key], ledger.from, target)),
  {from:target - 30 * MINUTE, to:target}]) {
  for (let base = Math.floor(range.from / BLOCK) * BLOCK; base <= range.to; base += BLOCK) bases.add(base);
 }
 const rows = new Map<number, StoredRow>(), prices = {BTC:new Map(), ETH:new Map(), SOL:new Map()} as Record<Asset, Map<number, PriceBar>>;
 const ordered = [...bases].sort((a, b) => a - b);
 for (let offset = 0; offset < ordered.length; offset += 12) {
  const batch = await Promise.all(ordered.slice(offset, offset + 12).map(readBlock));
  for (const block of batch) {
   for (const row of block.rows) if (row.t <= target) rows.set(row.t, row);
   for (const [asset, bars] of block.prices) for (const bar of bars) if (bar.t <= target) prices[asset].set(bar.t, bar);
  }
 }
 const features = {BTC:priceFeatures(prices.BTC), ETH:priceFeatures(prices.ETH), SOL:priceFeatures(prices.SOL)};
 const input = new Map<string, LaneInput>(LANES.map(definition => {
  const {asset, zone} = definition;
  return [definition.key, {bar:t => prices[asset].get(t), point:t => strategyDepth(rows.get(t), asset, zone), features:features[asset]}];
 }));
 for (const asset of ASSETS) {
  let latest: PriceBar | undefined;
  for (const bar of prices[asset].values()) if (!latest || bar.t > latest.t) latest = bar;
  const previous = ledger.marks[asset];
  if (latest && (!previous || latest.t >= previous.at)) ledger.marks[asset] = {at:latest.t, price:latest.c, fresh:latest.t === target};
  else if (previous) ledger.marks[asset] = {...previous, fresh:false};
 }
 return input;
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
 const unread = notices.filter(notice => Date.now() - notice.at <= 2 * MINUTE);
 if (!unread.length) return;
 clearTimeout(toastTimer);
 publish({toast:unread});
 toastTimer = setTimeout(() => publish({toast:[]}), 10000);
 if (!view.sound || !view.primed || !playing) return;
 for (const notice of unread) {
  void claimSound(notice.id).then(claimed => {
   if (!claimed || !active || !view.sound || !view.primed || !playing) return;
   const direction = notice.kind === 'move' && notice.after < notice.before ? 'direction-sell' : 'direction-buy';
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
 try {
  const target = Math.floor(Date.now() / MINUTE) * MINUTE - MINUTE;
  const stored = await readLedger(), ledger = stored ?? createLedger(target);
  const before = JSON.stringify(ledger);
  const input = await marketData(ledger, target);
  if (!current()) return;
  const result = advanceLedger(ledger, input, target);
  more = result.more;
  if (stored && before === JSON.stringify(ledger) && !result.records.length && !result.remove.length && !result.notices.length) {
   if (view.error) publish({error:''});
   return;
  }
  const inserted = await commitLedger(ledger, result.records, result.remove, result.notices, stamp!.epoch, current);
  if (inserted === null) {more = true; return;}
  if (current()) marketRuntime.publish({type:'strategy-update', owner:stamp!.id, epoch:stamp!.epoch, notices:inserted});
 } catch {
  fail();
 } finally {
  running = false;
  if (more || dirty) schedule(more ? 20 : 700);
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
  document.addEventListener('pointerdown', enableAudio);
  window.addEventListener('storage', preferenceChanged);
  window.addEventListener('pageshow', changed);
  detach.push(() => {
   document.removeEventListener('pointerdown', enableAudio);
   window.removeEventListener('storage', preferenceChanged);
   window.removeEventListener('pageshow', changed);
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
};
