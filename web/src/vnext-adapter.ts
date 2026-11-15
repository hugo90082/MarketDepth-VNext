import { ASSETS, VENUES, type Asset, type Venue } from '../shared/model';
import { CONTRACT, type StoredCandle, type StoredRow } from '../shared/contract';
import { MARKET_BLOCK_MS, emptyMarketBlock, marketContent, marketHash, type MarketBlock } from '../shared/market-history';
import { siteFetch } from './site-api';

const base = (import.meta.env.VITE_BFF_URL || '').replace(/\/$/, '');

export type VNextSpotRow = {
  t: number;
  available_at: number | null;
  venue: Exclude<Venue, 'all4'>;
  asset: Asset;
  bid_0_100: number | null;
  ask_0_100: number | null;
  bid_100_200: number | null;
  ask_100_200: number | null;
  bid_200_300: number | null;
  ask_200_300: number | null;
  bid_300_500: number | null;
  ask_300_500: number | null;
  bid_500_750: number | null;
  ask_500_750: number | null;
  observed_bid_bps: number | null;
  observed_ask_bps: number | null;
  trusted_bid_bps: number | null;
  trusted_ask_bps: number | null;
  captured_at: number | null;
  status: string;
  source: string | null;
  quality_json: string | null;
  revision: number;
};

export type VNextFutures1mRow = {
  t: number;
  available_at: number | null;
  asset: Asset;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
  status: string;
  source: string | null;
  revision: number;
};

export type VNextDay = {
  day: string;
  state: string;
  revision: number;
  from: number;
  to: number;
  counts?: Record<string, number>;
};

let apiLock: Promise<void> = Promise.resolve();

async function serializedV2Fetch(path: string, signal?: AbortSignal): Promise<Response> {
  const prev = apiLock;
  let release!: () => void;
  apiLock = new Promise<void>(r => { release = r; });
  await prev.catch(() => {});
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      const r = await siteFetch(base + path, { signal: signal ?? AbortSignal.timeout(15000) });
      if (r.status === 429 && attempt < 3) {
        const waitSec = Math.max(1, Number(r.headers.get('retry-after')) || 2);
        await new Promise(res => setTimeout(res, waitSec * 1000));
        continue;
      }
      return r;
    }
    throw new Error('API_RATE_LIMITED');
  } finally {
    release();
  }
}

export async function fetchVNextDays(fromDay = '2026-01-01', toDay = '2026-12-31', signal?: AbortSignal): Promise<VNextDay[]> {
  const r = await serializedV2Fetch(`/api/v2/days?from=${fromDay}&to=${toDay}`, signal);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const body = await r.json() as { ok: boolean; data: VNextDay[] };
  return (body.data ?? []).filter(d => d.state !== 'missing');
}

export async function fetchVNextHistoryKind<T>(kind: 'spot_depth' | 'futures_1m', from: number, to: number, signal?: AbortSignal): Promise<T[]> {
  if (to <= from) return [];
  const out: T[] = [];
  let cursor = '';
  for (let page = 0; page < 64; page++) {
    const q = `/api/v2/history?kind=${kind}&from=${from}&to=${to}&limit=2000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const r = await serializedV2Fetch(q, signal);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const body = await r.json() as { ok: boolean; data: T[]; meta?: { next_cursor?: string | null } };
    if (Array.isArray(body.data)) out.push(...body.data);
    const next = body.meta?.next_cursor;
    if (!next) break;
    cursor = next;
  }
  return out;
}

export function groupSpotRowsToStoredRows(spotRows: VNextSpotRow[]): StoredRow[] {
  const byMinute = new Map<number, VNextSpotRow[]>();
  for (const r of spotRows) {
    if (!Number.isSafeInteger(r.t) || r.t % 60000 !== 0) continue;
    const list = byMinute.get(r.t) ?? [];
    list.push(r);
    byMinute.set(r.t, list);
  }
  const result: StoredRow[] = [];
  for (const [t, group] of [...byMinute.entries()].sort((a, b) => a[0] - b[0])) {
    const d: [number | null, number | null][][][] = Array.from({ length: 4 }, () =>
      Array.from({ length: 3 }, () =>
        Array.from({ length: 5 }, (): [number | null, number | null] => [null, null]),
      ),
    );
    const captured: boolean[][] = Array.from({ length: 4 }, () => Array.from({ length: 3 }, () => false));
    let avail = t;
    for (const r of group) {
      const vi = VENUES.indexOf(r.venue);
      const ai = ASSETS.indexOf(r.asset);
      if (vi < 0 || ai < 0) continue;
      if (r.available_at && r.available_at > avail) avail = r.available_at;
      const zones: [number | null, number | null][] = [
        [r.bid_0_100, r.ask_0_100],
        [r.bid_100_200, r.ask_100_200],
        [r.bid_200_300, r.ask_200_300],
        [r.bid_300_500, r.ask_300_500],
        [r.bid_500_750, r.ask_500_750],
      ];
      d[vi][ai] = zones;
      if (zones.some(([b, a]) => b !== null || a !== null)) {
        captured[vi][ai] = true;
      }
    }
    result.push({
      t,
      a: Math.max(t, avail),
      d,
      source: 'railway',
      format: CONTRACT.datasetFormat,
      cadence: 60000,
      finalVersion: 1,
      captured,
    });
  }
  return result;
}

export function mapFutures1mToStoredCandles(f1Rows: VNextFutures1mRow[]): StoredCandle[] {
  const out: StoredCandle[] = [];
  for (const r of f1Rows) {
    if (
      !ASSETS.includes(r.asset) ||
      !Number.isSafeInteger(r.t) ||
      r.t % 60000 !== 0 ||
      r.open === null ||
      r.high === null ||
      r.low === null ||
      r.close === null ||
      r.volume === null
    ) {
      continue;
    }
    out.push({
      asset: r.asset,
      interval: 60000,
      t: r.t,
      o: r.open,
      h: r.high,
      l: r.low,
      c: r.close,
      v: r.volume,
      closed: true,
      complete: r.status === 'ok' || r.status === 'recovered',
      observedAt: r.available_at ?? (r.t + 60000),
      source: 'binance-usdm',
    });
  }
  return out;
}

export async function buildVNextMarketBlocks(from: number, to: number, signal?: AbortSignal): Promise<MarketBlock[]> {
  const alignedFrom = Math.floor(from / MARKET_BLOCK_MS) * MARKET_BLOCK_MS;
  const alignedTo = Math.ceil(to / MARKET_BLOCK_MS) * MARKET_BLOCK_MS;
  const [spotRaw, f1Raw] = await Promise.all([
    fetchVNextHistoryKind<VNextSpotRow>('spot_depth', alignedFrom, alignedTo, signal),
    fetchVNextHistoryKind<VNextFutures1mRow>('futures_1m', alignedFrom, alignedTo, signal),
  ]);
  const rows = groupSpotRowsToStoredRows(spotRaw);
  const candles = mapFutures1mToStoredCandles(f1Raw);
  const blocks: MarketBlock[] = [];
  for (let b = alignedFrom; b < alignedTo; b += MARKET_BLOCK_MS) {
    const bRows = rows.filter(r => r.t >= b && r.t < b + MARKET_BLOCK_MS);
    const bCandles = candles.filter(c => c.t >= b && c.t < b + MARKET_BLOCK_MS);
    if (!bRows.length && !bCandles.length) continue;
    const content = marketContent({ ...emptyMarketBlock(b), rows: bRows, candles: bCandles });
    const sha256 = await marketHash(content);
    blocks.push({ ...content, version: 1, sha256 });
  }
  return blocks;
}
