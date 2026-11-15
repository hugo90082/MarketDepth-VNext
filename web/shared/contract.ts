import type {BookQuality} from './research-book';
import { CADENCE, ZONES, type Pair, type SpotRow, type Candle, type Asset } from './model';

export const CONTRACT = { schema: 'MD-SPOT-30S-USD-3', datasetFormat: 'MARKET_DEPTH_USD_NOTIONAL_TRUSTED_COVERAGE_V2', depthUnit: 'USD_NOTIONAL', quoteToUSDPolicy: 'RAW_QUOTE_PRICE_ASSUMED_USD_1_TO_1_NO_FX' } as const;
export const COLLECTION = 'MARKET_DEPTH_COLLECTION_30S_5ZONE_USD_3';
export const INDEX_SCHEMA = 'MD-HISTORY-INDEX-3';
export const HISTORY_DELAY = 900_000;
export const WINDOW = 168 * 3_600_000;
export type Interval = 30_000 | 60_000 | 300_000 | 900_000 | 3_600_000 | 14_400_000 | 43_200_000;
export type Span = { from: number; to: number };
export type StoredRow = SpotRow & { source: 'browser' | 'recent' | 'railway'; format: typeof CONTRACT.datasetFormat; finalVersion?:number; captured?: boolean[][]; issues?: string[]; quality?: {version:'FORMAL_AVAILABLE_V1'|'FORMAL_AVAILABLE_V2'; books:(BookQuality|null)[][]} };
export type StoredCandle = Candle & { asset: Asset; interval: Interval; complete: boolean; observedAt?: number;source?:'binance-usdm'|'legacy-30s'|'import' };
export function isContract(x: any) { return x?.depthUnit === CONTRACT.depthUnit && x?.quoteToUSDPolicy === CONTRACT.quoteToUSDPolicy; }
export function emptyRow(t: number): SpotRow { return { t, a: t, d: Array.from({ length: 4 }, () => Array.from({ length: 3 }, () => ZONES.map(() => [null, null] as Pair))) }; }
export function validData(r: SpotRow) { return r.d.some(v => v.some(a => a.some(p => p.some(n => n !== null)))); }
export function needsConfirmation(r: StoredRow) { return r.source === 'recent' || (r.source === 'browser' && ((!validData(r)) || r.captured?.some(v=>v.some(ok=>!ok)) || r.d.some(v=>v.some(a=>a.some(p=>p.some(n=>n===null)))))); }
export function gaps(rows: StoredRow[], from: number, to: number, confirmed: Span[] = []): Span[] {
  const map = new Map(rows.map(r => [r.t, r])); const out: Span[] = [];
  for (let t = Math.ceil(from / CADENCE) * CADENCE; t < to; t += CADENCE) {
    const r = map.get(t);
    if ((!r || needsConfirmation(r)) && !confirmed.some(s => s.from <= t && s.to >= t + CADENCE)) {
      if (out.at(-1)?.to === t) out[out.length - 1].to += CADENCE; else out.push({ from: t, to: t + CADENCE });
    }
  }
  return out;
}
export function mergeSpans(input: Span[]): Span[] {
  const out: Span[] = [];
  for (const s of [...input].sort((a,b) => a.from - b.from)) { const last = out.at(-1); if (last && s.from <= last.to) last.to = Math.max(last.to, s.to); else out.push({ ...s }); }
  return out;
}
export function aggregateCandles(rows: StoredCandle[], interval: Interval): (Candle & { complete: boolean })[] {
  if (interval <= 60000) return rows.filter(c => c.interval === interval).sort((a,b) => a.t-b.t);
  const groups = new Map<number, StoredCandle[]>();
  for (const c of rows.filter(c => c.interval === 60000)) { const t = Math.floor(c.t / interval) * interval; groups.set(t, [...groups.get(t) ?? [], c]); }
  const derived=rows.filter(c=>c.interval===interval);
  return [...derived,...[...groups].sort(([a],[b])=>a-b).map(([t, g]) => {
    g.sort((a,b)=>a.t-b.t);
    const complete = g.length === interval / 60000 && g.every((c,i) => c.t === t + i*60000 && c.complete);
    return { t, o:g[0].o, h:Math.max(...g.map(c=>c.h)), l:Math.min(...g.map(c=>c.l)), c:g.at(-1)!.c, v:g.reduce((n,c)=>n+c.v,0), closed:complete && g.every(c=>c.closed), complete };
  })].sort((a,b)=>a.t-b.t);
}
export function barWidths(bid: number | null, ask: number | null): [number, number] { return bid === null || ask === null || bid + ask <= 0 ? [0,0] : [100 * bid / (bid+ask), 100 * ask / (bid+ask)]; }
/** Recent is an unsealed live-gap aid: keep independently verified browser
 * values when Railway cannot confirm that side. Sealed Historical still
 * replaces the entire row in storage.save. */
export function mergeRecentGap(local:StoredRow|undefined,remote:SpotRow):StoredRow{
 const d=remote.d.map((venues,vi)=>venues.map((zones,ai)=>zones.map((pair,zi)=>pair.map((value,side)=>value??local?.d[vi]?.[ai]?.[zi]?.[side]??null) as Pair)));
 return {...remote,d,source:'recent',format:CONTRACT.datasetFormat,captured:local?.captured,issues:local?.issues};
}
