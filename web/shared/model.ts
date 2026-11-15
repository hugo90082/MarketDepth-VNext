export const ASSETS = ['BTC', 'ETH', 'SOL'] as const;
export type Asset = typeof ASSETS[number];
export const VENUES = ['binance', 'coinbase', 'kraken', 'bitfinex'] as const;
export type Venue = typeof VENUES[number] | 'all4';
export const VENUE_NAMES = ['Binance', 'Coinbase', 'Kraken', 'Bitfinex'];
export const ZONES = [[0, 100], [100, 200], [200, 300], [300, 500], [500, 750]] as const;
export const CADENCE = 30_000;
export const STALE_AFTER = 60_000;
export const DAY = 86_400_000;
export type Qty = number | null;
export type Pair = [Qty, Qty];
export type ViewStats={available:number;full:number;partial:number;unknown:number;final:number;backendValid:number;backendNull:number;backendZero:number};
export interface SpotRow { t: number; a: number; d: Pair[][][]; cadence?: 60000; bucket?:{interval:number;values:Pair[][][];stats:ViewStats[][][];observed:number} }
export interface ChunkMeta { id: string; kind: string; schema: string; startTsMs: number; endTsMs: number; rows: number; bytes: number; sha256: string }
export interface IndexPage { ok: true; data: ChunkMeta[]; nextCursor: number; meta: { indexVersion: number; indexUpdatedTsMs: number; schema: string } }
export interface RecentMeta {
  schema: string; cadenceMs: number; bufferMs: number; pollMinMs: number;
  staleAfterMs: number; oldestAvailableTsMs: number; latestTargetTsMs: number;
  dataAgeMs: number | null; stale: boolean;
}
export interface RecentPayload { ok: true; data: SpotRow[]; meta: RecentMeta }
export interface Candle { t: number; o: number; h: number; l: number; c: number; v: number; closed: boolean }
export interface Connection { state: 'starting' | 'ok' | 'error' | 'unauthorized'; lastSuccessAtMs: number | null; error: string | null }
export interface BffStatus {
  serverNowMs: number; recent: Connection; history: Connection; price: Connection;
  dataAgeMs: number | null; latestTargetTsMs: number | null; stale: boolean;
  indexVersion: number | null; upstreamVerified: boolean;
}
export interface HistoryPayload {
  ok: true; data: SpotRow[]; meta: { indexVersion: number | null; loadedChunks: number; totalChunks: number; complete: boolean; oldestRetainedTsMs: number | null; indexReady: boolean; connection: Connection }
}
export interface RecentView { ok: true; data: SpotRow[]; meta: { dataAgeMs: number | null; stale: boolean; latestTargetTsMs: number | null; connection: Connection } }
export interface KlinePayload { ok: true; data: Candle[]; meta: { asset: Asset; source: string; ageMs: number | null; connection: Connection } }

export function validateRow(value: unknown): SpotRow {
  const x = value as SpotRow;
  if (!x || !Number.isSafeInteger(x.t) || x.t < 0 || x.t % CADENCE || !Number.isSafeInteger(x.a) || x.a < 0 ||
      !Array.isArray(x.d) || x.d.length !== 4 || !x.d.every(v => Array.isArray(v) && v.length === 3 &&
        v.every(a => Array.isArray(a) && a.length === 5 && a.every(z => Array.isArray(z) && z.length === 2 &&
          z.every(n => n === null || (typeof n === 'number' && Number.isFinite(n) && n >= 0)))))) {
    throw new Error('INVALID_SPOT_ROW');
  }
  return x;
}
export function validateRows(value: unknown): SpotRow[] {
  if (!Array.isArray(value)) throw new Error('INVALID_SPOT_ROWS');
  const rows = value.map(validateRow);
  if (rows.some((r, i) => i > 0 && r.t <= rows[i - 1].t)) throw new Error('UNSORTED_SPOT_ROWS');
  return rows;
}
export function sumStrict(values: Qty[]): Qty {
  return values.length && values.every(n => n !== null) ? (values as number[]).reduce((s, n) => s + n, 0) : null;
}
export function imbalance(bid: Qty, ask: Qty): Qty {
  return bid === null || ask === null || bid + ask <= 0 ? null : (bid - ask) / (bid + ask);
}
export function depth(row: (SpotRow & {quality?:{version:string;books:({bidBps:number;askBps:number}|null)[][]}}) | undefined, asset: Asset, venue: Venue, zones: number[]) {
  if (!row) return { bid: null, ask: null, ratio: null, fullVenues: 0 };
  const ai = ASSETS.indexOf(asset);
  const pairs = row.d.map((v,vi) => {
    const quality=row.quality?.version==='FORMAL_AVAILABLE_V2'?row.quality.books[vi]?.[ai]:null;
    const sum=(side:0|1):Qty=>{
      const values=zones.map(z=>v[ai][z][side]);
      if(!quality)return sumStrict(values);
      const coverage=side===0?quality.bidBps:quality.askBps;
      // New samples distinguish an unobserved outer range from a missing
      // sample. Sum only known amounts; never rewrite nulls or infer orders.
      if(zones.some((z,i)=>values[i]===null&&coverage>ZONES[z][0]))return null;
      const known=values.filter((n):n is number=>n!==null);
      return known.length?known.reduce((total,n)=>total+n,0):null;
    };
    return [sum(0),sum(1)] as Pair;
  });
  const selected = venue === 'all4' ? pairs : [pairs[VENUES.indexOf(venue)]];
  const usable=selected.filter((p):p is [number,number]=>p[0]!==null&&p[1]!==null);
  const bid=venue!=='all4'?selected[0][0]:usable.length?usable.reduce((n,p)=>n+p[0],0):null;
  const ask=venue!=='all4'?selected[0][1]:usable.length?usable.reduce((n,p)=>n+p[1],0):null;
  return { bid, ask, ratio: imbalance(bid, ask), fullVenues: pairs.filter(p => p[0] !== null && p[1] !== null).length };
}
export function mergeRows(recent: SpotRow[], historical: SpotRow[]): SpotRow[] {
  return [...new Map([...recent, ...historical].map(r => [r.t, r])).values()].sort((a, b) => a.t - b.t);
}
export function ageAt(base: number | null, receivedAt: number | null, now: number): number | null {
  return base === null || receivedAt === null ? null : base + Math.max(0, now - receivedAt);
}
export function gridRows(rows: SpotRow[], from: number, to: number): { t: number; row?: SpotRow }[] {
  const map = new Map(rows.map(r => [r.t, r]));
  const result: { t: number; row?: SpotRow }[] = [];
  for (let t = Math.ceil(from / CADENCE) * CADENCE; t <= to; t += CADENCE) result.push({ t, row: map.get(t) });
  return result;
}
