import { marketRuntime } from '../runtime/client';
import * as storage from '../storage';
import { localMaintenance } from '../local-maintenance';
import { AUTH_REQUIRED_EVENT } from '../site-api';
import { MARKET_BLOCK_MS, MARKET_BATCH_MS, marketHash, type MarketBlock } from '../../shared/market-history';
import { blockCoverage, sumCoverage, type Coverage, type MarketSource } from '../../shared/market-sync';
import type { Asset } from '../../shared/model';
import { buildVNextMarketBlocks, fetchVNextDays } from '../vnext-adapter';

type CloudSummary = { oldest: number | null; newest: number | null; blocks: number; version: number };
type Download = { from: number; to: number; blocks: number; total: number; complete: boolean; expected: number; coverage: Coverage };
type State = {
  authenticated: boolean;
  eligible: boolean;
  expiresAt: number | null;
  pending: number;
  cloud: CloudSummary | null;
  archiveComplete: boolean;
  phase: string;
  error: string;
  source: MarketSource | null;
  scan: storage.HistoryScan | null;
  counts: { saved: number; valuesSaved: number; superseded: number; conflicts: number };
  download: Download | null;
  downloadError: string;
};
type Pull = {
  hours: number;
  from: number;
  to: number;
  cursor: number;
  bases: number[];
  initial: boolean;
  total?: number;
  stats?: Record<string, Coverage>;
  statsSource?: 'vnext-v2';
};

const VNEXT_SOURCE: MarketSource = {
  code: 'VNEXT',
  configured: true,
  valid: true,
  isPrimary: true,
  canUpload: false,
  assignment: 'vm-vnext',
};

const initial: State = {
  authenticated: false,
  eligible: false,
  expiresAt: null,
  pending: 0,
  cloud: null,
  archiveComplete: true,
  phase: '等待主控',
  error: '',
  source: VNEXT_SOURCE,
  scan: null,
  counts: { saved: 0, valuesSaved: 0, superseded: 0, conflicts: 0 },
  download: null,
  downloadError: '',
};

let state: State = initial;
let started = false;
let running = false;
let pulling = false;
let nextAt = 0;
let nextPullAt = 0;
let pullFailures = 0;
let initialized = false;
const listeners = new Set<() => void>();
const channel = marketRuntime.researchChannel();
const baseReads = new Map<number, Promise<boolean>>();

const fence = (): storage.CollectorFence | null => {
  const stamp = marketRuntime.collectorStamp();
  return marketRuntime.isCollector(stamp) ? { term: stamp!.epoch, current: () => marketRuntime.isCollector(stamp) } : null;
};

function notify(next: Partial<State>) {
  state = { ...state, ...next };
  for (const cb of listeners) cb();
  const stamp = marketRuntime.collectorStamp();
  if (marketRuntime.isCollector(stamp)) {
    marketRuntime.publish({ type: 'market-history-state', owner: stamp!.id, epoch: stamp!.epoch, state });
  }
}

async function importBlock(block: MarketBlock, f: storage.CollectorFence) {
  const result = await storage.applyMarketCloud(block, f);
  if (result.changed && f.current()) channel?.postMessage({ type: 'changed' });
  await storage.marketHistoryMeta(
    'market-history-coverage:' + block.base,
    { version: block.version, coverage: blockCoverage(block, block.base, block.base + MARKET_BLOCK_MS, result.conflicts.length) },
    f,
  );
  return result;
}

async function readBase(at: number, f: storage.CollectorFence) {
  const start = Math.floor(at / MARKET_BLOCK_MS) * MARKET_BLOCK_MS;
  const seen = await storage.getMeta<{ version: number; hash: string }>('market-history-seen:' + start);
  const head = await storage.marketHistoryHead(start);
  if (seen && head && (await marketHash(await storage.marketHistoryContent(start))) === seen.hash) return true;
  const blocks = await buildVNextMarketBlocks(start, start + MARKET_BLOCK_MS);
  const block = blocks.find(b => b.base === start);
  if (!block || !f.current()) return false;
  await importBlock(block, f);
  return true;
}

async function pullWindow(f: storage.CollectorFence) {
  let p = await storage.getMeta<Pull>('market-history-pull');
  const hours = localMaintenance.requestedHours() || p?.hours;
  if (!hours) return false;
  const now = Date.now();
  const requested = localMaintenance.requestedHours();
  const valid = () => f.current() && (!localMaintenance.requestedHours() || localMaintenance.requestedHours() === hours);

  const windowFrom = Math.floor((now - hours * 3600000) / MARKET_BLOCK_MS) * MARKET_BLOCK_MS;
  const windowTo = Math.floor(now / MARKET_BLOCK_MS) * MARKET_BLOCK_MS + MARKET_BLOCK_MS;

  if (!p || p.hours !== hours || p.statsSource !== 'vnext-v2' || p.from !== windowFrom) {
    const bases: number[] = [];
    for (let b = windowFrom; b < windowTo; b += MARKET_BLOCK_MS) {
      bases.push(b);
    }
    // Sync newest blocks first so recent charts render immediately
    bases.reverse();
    p = {
      hours,
      from: windowFrom,
      to: windowTo,
      cursor: 0,
      bases,
      initial: true,
      total: bases.length,
      stats: p?.stats ?? {},
      statsSource: 'vnext-v2',
    };
  }

  p.stats ??= {};
  for (const key of Object.keys(p.stats)) {
    if (Number(key) < p.from || Number(key) >= p.to) delete p.stats[key];
  }

  const end = Math.min(p.to, Math.ceil(now / 60000) * 60000);
  const stats = p.stats;

  // Skip already-cached blocks (except the current active 15m block)
  while (p.bases.length > 0 && valid()) {
    const candidate = p.bases[0];
    const isCurrentBlock = candidate + MARKET_BLOCK_MS >= now - 60000;
    const coverage = await storage.getMeta<{ version: number; coverage: Coverage }>('market-history-coverage:' + candidate);
    const seen = await storage.getMeta<{ version: number; hash: string }>('market-history-seen:' + candidate);
    const head = await storage.marketHistoryHead(candidate);
    if (!isCurrentBlock && coverage && seen && head) {
      stats[candidate] = coverage.coverage;
      p.bases.shift();
      continue;
    }
    break;
  }

  if (p.bases.length > 0 && valid()) {
    // Fetch a contiguous batch of up to 8 blocks (2 hours) in one /api/v2/history call
    const firstBase = p.bases[0];
    const batchBases = [firstBase];
    for (let i = 1; i < p.bases.length && batchBases.length < 8; i++) {
      if (Math.abs(p.bases[i] - batchBases[batchBases.length - 1]) === MARKET_BLOCK_MS) {
        batchBases.push(p.bases[i]);
      } else {
        break;
      }
    }
    const minBase = Math.min(...batchBases);
    const maxBase = Math.max(...batchBases) + MARKET_BLOCK_MS;
    const fetchedBlocks = await buildVNextMarketBlocks(minBase, maxBase);
    if (!valid()) return false;
    const byBase = new Map(fetchedBlocks.map(b => [b.base, b]));
    for (const b of batchBases) {
      const blk = byBase.get(b);
      if (blk) {
        const result = await importBlock(blk, f);
        const after = await storage.marketHistoryHead(b);
        if (after && valid()) {
          await storage.marketHistoryMeta('market-history-read:' + b, { key: after.key, version: 1 }, f);
        }
        stats[b] = blockCoverage(blk, p.from, end, result.conflicts.length);
      }
      const idx = p.bases.indexOf(b);
      if (idx >= 0) p.bases.splice(idx, 1);
    }
  }

  if (!p.bases.length) {
    p.initial = false;
  }

  if (valid()) {
    await storage.marketHistoryMeta('market-history-pull', p, f);
    notify({
      download: {
        from: p.from,
        to: end,
        blocks: Object.keys(stats).length,
        total: p.total ?? Object.keys(stats).length,
        complete: !p.initial && !p.bases.length,
        expected: Math.max(0, Math.floor((end - p.from) / 60000)),
        coverage: sumCoverage(Object.values(stats)),
      },
    });
  }
  return !!(p.initial || p.bases.length) && !!requested;
}

async function run() {
  const f = fence();
  if (!f || running || Date.now() < nextAt) return;
  running = true;
  nextAt = Date.now() + MARKET_BATCH_MS;
  try {
    if (!initialized) {
      await storage.initStorage();
      initialized = true;
      await storage.discoverMarketHistory();
    }
    const sessResp = await fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' });
    const sess = await sessResp.json().catch(() => null) as { authenticated?: boolean; expiresAt?: number | null } | null;
    const authenticated = !!sess?.authenticated;
    if (!authenticated) {
      notify({
        source: VNEXT_SOURCE,
        authenticated: false,
        eligible: false,
        expiresAt: null,
        pending: 0,
        scan: null,
        phase: '等待歷史授權',
        error: '',
      });
      return;
    }
    const days = await fetchVNextDays();
    if (!f.current()) return;
    const oldest = days.length ? days[0].from : null;
    const newest = days.length ? Math.min(Date.now(), days[days.length - 1].to) : null;
    const blocks = oldest !== null && newest !== null ? Math.max(1, Math.floor((newest - oldest) / MARKET_BLOCK_MS)) : 0;
    notify({
      source: VNEXT_SOURCE,
      authenticated: true,
      eligible: false,
      expiresAt: sess?.expiresAt ?? null,
      cloud: { oldest, newest, blocks, version: 1 },
      archiveComplete: true,
      pending: 0,
      scan: null,
      phase: 'VNext 雲端同步與本機快取模式',
      error: '',
    });
  } catch (e) {
    if (f.current()) {
      notify({ phase: '稍後重試', error: e instanceof Error ? e.message : 'VNext 歷史同步失敗，資料保留。' });
    }
  } finally {
    running = false;
  }
}

async function runPull() {
  const f = fence();
  if (!f || pulling || !initialized || !state.authenticated || Date.now() < nextPullAt) return;
  pulling = true;
  try {
    if (await storage.getMeta('quotaBlocked')) {
      notify({ downloadError: '本機容量受保護，暫停可重建下載；既有資料保留。' });
      nextPullAt = Date.now() + 30000;
      return;
    }
    const more = await pullWindow(f);
    if (!f.current()) return;
    pullFailures = 0;
    notify({ downloadError: '' });
    nextPullAt = Date.now() + (more ? 250 : 15000);
  } catch (e) {
    if (f.current()) {
      nextPullAt = Date.now() + Math.min(30000, 1000 * 2 ** Math.min(5, pullFailures++));
      notify({ downloadError: e instanceof Error ? e.message : '歷史下載失敗，稍後續傳。' });
    }
  } finally {
    pulling = false;
  }
}

export const marketHistoryRuntime = {
  snapshot: () => state,
  subscribe(cb: () => void) {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
  async beforeCandleFetch(at: number) {
    const f = fence();
    if (!f || !state.authenticated) return false;
    const key = Math.floor(at / MARKET_BLOCK_MS) * MARKET_BLOCK_MS;
    let task = baseReads.get(key);
    if (!task) {
      task = readBase(at, f).catch(() => false).finally(() => baseReads.delete(key));
      baseReads.set(key, task);
    }
    return task;
  },
  async candleFetchBoundary(at: number, end: number, _asset?: Asset) {
    return Math.min(end, Math.floor(at / MARKET_BLOCK_MS) * MARKET_BLOCK_MS + MARKET_BLOCK_MS);
  },
  async comparisonComplete(_jobId: string) {
    nextAt = 0;
    void run();
  },
  async prepareEnable() {
    if (state.authenticated) return true;
    return new Promise<boolean>(resolve => {
      const done = (ok: boolean) => {
        window.removeEventListener('marketdepth-auth-resumed', success);
        window.removeEventListener('marketdepth-auth-cancelled', cancel);
        resolve(ok);
      };
      const success = () => done(true);
      const cancel = () => done(false);
      window.addEventListener('marketdepth-auth-resumed', success);
      window.addEventListener('marketdepth-auth-cancelled', cancel);
      window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT));
    });
  },
  start() {
    if (started) return;
    started = true;
    marketRuntime.events(m => {
      if (m.type === 'market-history-state' && !marketRuntime.isLeader()) {
        const s = marketRuntime.collectorStamp();
        if (s && m.owner === s.id && m.epoch === s.epoch) {
          notify(m.state);
        }
      }
    });
    marketRuntime.subscribe(() => {
      void run();
    });
    window.addEventListener('marketdepth-auth-resumed', () => {
      nextAt = 0;
      nextPullAt = 0;
      void run();
    });
    setInterval(() => void run(), 2000);
    setInterval(() => void runPull(), 500);
    void run();
  },
};
