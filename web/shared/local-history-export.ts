import {ASSETS,VENUES,ZONES,depth,type Asset,type Venue} from './model';
import {CONTRACT,type StoredRow,type StoredCandle} from './contract';
import {VIEW_ZONES} from './history-view';

export const LOCAL_EXPORT_FORMAT='MARKETDEPTH_LOCAL_HISTORY_JSONL_V1';
export const LOCAL_EXPORT_LOCK='marketdepth-local-history-export-v1';
export const STORAGE_MAINTENANCE_LOCK='marketdepth-storage-maintenance';
export const EXPORT_VENUES:readonly Venue[]=[...VENUES,'all4'];
export function exportManifest(startedAt:number,blocks:number){return {
 type:'manifest',format:LOCAL_EXPORT_FORMAT,exportedAt:startedAt,exportedAtIso:new Date(startedAt).toISOString(),cadenceMs:60000,blocks,
 scope:'local-browser-only',snapshot:'per-block-version-at-read-time',timestampUnit:'UTC_UNIX_MILLISECONDS',
 timestampMeaning:{candle:'minute-open-time',depth:'sample-target-time',a:'actual-sample-completion-time',capturedAt:'source-capture-time'},
 assets:ASSETS,depthVenues:VENUES,ratioVenues:EXPORT_VENUES,depthZonesBps:ZONES,ratioZoneIndices:VIEW_ZONES,
 depthMatrixOrder:['venue','asset','zone','bid-ask'],ratioMatrixOrder:['venue','asset','depth-choice'],
 ratioFormula:'(bidUSD-askUSD)/(bidUSD+askUSD); null when unknown or total is zero; ALL4 sums usable paired sources before ratio',
 ...CONTRACT,priceMarket:'Binance USDT perpetual; source=null means unknown',volumeUnit:'base-asset-quantity',
 missingMinutes:'omitted, never filled; null means unknown, 0 means a recorded zero',
 unknownQuality:'null; not inferred from available amounts',
 };}
export function exportDepth(row:StoredRow){
 // Whitelist source metadata; private database fields must never enter backups.
 const quality=row.quality?{version:row.quality.version,books:row.quality.books.map(v=>v.map(q=>q?{
  capturedAt:q.capturedAt,feed:q.feed,bidBps:q.bidBps,askBps:q.askBps,complete:q.complete,mode:q.mode,
  lastMessageAt:q.lastMessageAt,snapshotAt:q.snapshotAt,observedBidBps:q.observedBidBps,observedAskBps:q.observedAskBps,coverageMode:q.coverageMode,
 }:null))}:null;
 return {type:'depth',t:row.t,a:row.a,cadence:60000,d:row.d,source:row.source,format:row.format,finalVersion:row.finalVersion??null,captured:row.captured??null,issues:row.issues??[],quality,
 ratios:EXPORT_VENUES.map(venue=>ASSETS.map(asset=>VIEW_ZONES.map(zones=>depth(row,asset,venue,zones).ratio))),
 };
}
export function exportCandle(c:StoredCandle){return {type:'candle',asset:c.asset,interval:60000,t:c.t,o:c.o,h:c.h,l:c.l,c:c.c,v:c.v,closed:c.closed,complete:c.complete,observedAt:c.observedAt??null,source:c.source??null};}
type Range={count:number;from:number|null;to:number|null;missingMinutes:number};
const range=():Range=>({count:0,from:null,to:null,missingMinutes:0});
export class ExportTotals{
 blocks=0;depthRows=0;candles=0;
 readonly assets=Object.fromEntries(ASSETS.map(a=>[a,{depth:range(),candles:range()}])) as Record<Asset,{depth:Range;candles:Range}>;
 private add(r:Range,t:number){if(r.to!==null)r.missingMinutes+=Math.max(0,(t-r.to)/60000-1);r.count++;r.from??=t;r.to=t;}
 depth(row:StoredRow){this.depthRows++;for(const asset of ASSETS)this.add(this.assets[asset].depth,row.t);}
 candle(c:StoredCandle){this.candles++;this.add(this.assets[c.asset].candles,c.t);}
 summary(completedAt:number){return {type:'summary',complete:true,completedAt,blocks:this.blocks,depthRows:this.depthRows,candles:this.candles,assets:this.assets};}
}
export type ExportSummary=ReturnType<ExportTotals['summary']>;
export type ExportProgress={blocks:number;totalBlocks:number;depthRows:number;candles:number};
