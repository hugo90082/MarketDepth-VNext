import {CONTRACT,type StoredRow,type StoredCandle} from './contract';
import {ASSETS,validateRow} from './model';
import {validCandle} from './chart-data';
import type {BookQuality} from './research-book';

export const MARKET_HISTORY_VERSION=2;
export const MARKET_BLOCK_MS=900000;
export const MARKET_BATCH_MS=30000;
export const MARKET_WIRE_LIMIT=256*1024;
export const MARKET_DECODED_LIMIT=1024*1024;
export type MarketContent={format:'MD-MARKET-MINUTE-1';base:number;rows:StoredRow[];candles:StoredCandle[]};
export type MarketBlock=MarketContent&{version:number;sha256:string};
export const emptyMarketBlock=(base:number):MarketContent=>({format:'MD-MARKET-MINUTE-1',base,rows:[],candles:[]});

const text=(v:unknown,max=256)=>typeof v==='string'&&v.length<=max;
function qualityBook(value:any):BookQuality|null{
 if(value===null)return null;
 if(!value||!Number.isSafeInteger(value.capturedAt)||value.capturedAt<0||!text(value.feed)||!text(value.mode)||![value.bidBps,value.askBps].every(n=>Number.isFinite(n)&&n>=0)||!Array.isArray(value.complete)||value.complete.length!==5||!value.complete.every((b:unknown)=>typeof b==='boolean'))throw new Error('INVALID_QUALITY');
 const result:BookQuality={capturedAt:value.capturedAt,feed:value.feed,bidBps:value.bidBps,askBps:value.askBps,complete:[...value.complete],mode:value.mode};
 for(const k of ['lastMessageAt','snapshotAt','observedBidBps','observedAskBps'] as const)if(value[k]!==undefined){if(!Number.isFinite(value[k])||value[k]<0)throw new Error('INVALID_QUALITY');result[k]=value[k];}
 if(value.coverageMode==='sequenced-diff')result.coverageMode=value.coverageMode;
 return result;
}
/** Whitelist market fields; settings, credentials and arbitrary extra data never persist. */
export function marketContent(value:any,now=Date.now()):MarketContent{
 if(value?.format!=='MD-MARKET-MINUTE-1'||!Number.isSafeInteger(value.base)||value.base<0||value.base%MARKET_BLOCK_MS||value.base>now||!Array.isArray(value.rows)||value.rows.length>15||!Array.isArray(value.candles)||value.candles.length>45)throw new Error('INVALID_MARKET_BLOCK');
 const end=value.base+MARKET_BLOCK_MS;
 const rows=value.rows.map((raw:any):StoredRow=>{
  validateRow(raw);
  if(raw.cadence!==60000||raw.format!==CONTRACT.datasetFormat||raw.t%60000||raw.t<value.base||raw.t>=end||raw.t>now||!['browser','recent','railway'].includes(raw.source))throw new Error('INVALID_MINUTE_ROW');
  const row:StoredRow={t:raw.t,a:raw.a,d:raw.d.map((v:any)=>v.map((a:any)=>a.map((p:any)=>[...p]))),cadence:60000,source:raw.source,format:CONTRACT.datasetFormat};
  if(raw.finalVersion!==undefined){if(!Number.isSafeInteger(raw.finalVersion)||raw.finalVersion<0)throw new Error('INVALID_FINAL_VERSION');row.finalVersion=raw.finalVersion;}
  if(raw.captured!==undefined){if(!Array.isArray(raw.captured)||raw.captured.length!==4||!raw.captured.every((v:any)=>Array.isArray(v)&&v.length===3&&v.every((b:any)=>typeof b==='boolean')))throw new Error('INVALID_CAPTURED');row.captured=raw.captured.map((v:boolean[])=>[...v]);}
  if(raw.issues!==undefined){if(!Array.isArray(raw.issues)||raw.issues.length>24||!raw.issues.every((v:unknown)=>text(v,512)))throw new Error('INVALID_ISSUES');row.issues=[...raw.issues];}
  if(raw.quality!==undefined){const q=raw.quality;if(!['FORMAL_AVAILABLE_V1','FORMAL_AVAILABLE_V2'].includes(q?.version)||!Array.isArray(q.books)||q.books.length!==4||!q.books.every((v:any)=>Array.isArray(v)&&v.length===3))throw new Error('INVALID_QUALITY');row.quality={version:q.version,books:q.books.map((v:any)=>v.map(qualityBook))};}
  return row;
 }).sort((a:StoredRow,b:StoredRow)=>a.t-b.t);
 const candles=value.candles.map((c:any):StoredCandle=>{
  if(!validCandle(c)||!ASSETS.includes(c.asset)||c.interval!==60000||c.t%60000||c.t<value.base||c.t>=end||!c.closed||c.t+60000>now||typeof c.complete!=='boolean')throw new Error('INVALID_CLOSED_CANDLE');
  const result:StoredCandle={asset:c.asset,interval:60000,t:c.t,o:c.o,h:c.h,l:c.l,c:c.c,v:c.v,closed:true,complete:c.complete};
  if(c.observedAt!==undefined){if(!Number.isSafeInteger(c.observedAt)||c.observedAt<0)throw new Error('INVALID_CANDLE_TIME');result.observedAt=c.observedAt;}
  if(c.source!==undefined){if(!['binance-usdm','legacy-30s','import'].includes(c.source))throw new Error('INVALID_CANDLE_SOURCE');result.source=c.source;}
  return result;
 }).sort((a:StoredCandle,b:StoredCandle)=>a.asset.localeCompare(b.asset)||a.t-b.t);
 if(new Set(rows.map((r:StoredRow)=>r.t)).size!==rows.length||new Set(candles.map((c:StoredCandle)=>c.asset+':'+c.t)).size!==candles.length)throw new Error('DUPLICATE_MINUTE');
 return {format:'MD-MARKET-MINUTE-1',base:value.base,rows,candles};
}
export async function marketHash(value:unknown){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)));return [...new Uint8Array(bytes)].map(n=>n.toString(16).padStart(2,'0')).join('');}
export const railwayReadbackHash=(rows:StoredRow[])=>marketHash(rows.map(r=>({t:r.t,d:r.d})).sort((a,b)=>a.t-b.t));
const score=(row:StoredRow)=>{
 let available=0,complete=0;
 for(let vi=0;vi<4;vi++)for(let ai=0;ai<3;ai++){
  if(row.d[vi][ai].some(p=>p.every(n=>n!==null)))available++;
  complete+=row.quality?.books[vi]?.[ai]?.complete.filter(Boolean).length??0;
 }
 return [available,complete,-Math.abs(row.a-row.t)];
};
export async function preferMarketRow(old:StoredRow|undefined,next:StoredRow):Promise<StoredRow>{
 if(!old)return next;
 if(old.source==='railway'||next.source==='railway'){
  if(old.source!==next.source)return next.source==='railway'?next:old;
  if((next.finalVersion??-1)!==(old.finalVersion??-1))return (next.finalVersion??-1)>(old.finalVersion??-1)?next:old;
  // Different sealed contents without a newer upstream version are not ordered.
  return old;
 }
 const a=score(old),b=score(next);for(let i=0;i<a.length;i++)if(a[i]!==b[i])return b[i]>a[i]?next:old;
 return (await marketHash(next))<(await marketHash(old))?next:old;
}
const candleScore=(c:StoredCandle)=>[Number(c.complete),c.source==='binance-usdm'?2:c.source?1:0];
export function preferMarketCandle(old:StoredCandle|undefined,next:StoredCandle){
 if(!old)return {candle:next,conflict:false};const a=candleScore(old),b=candleScore(next);
 for(let i=0;i<a.length;i++)if(a[i]!==b[i])return {candle:b[i]>a[i]?next:old,conflict:false};
 const conflict=['o','h','l','c','v'].some(k=>(old as any)[k]!== (next as any)[k]);
 return {candle:old,conflict};
}
export async function mergeMarketContent(old:MarketContent|undefined,incoming:MarketContent,trustedRailway=false,canonicalCandles=false){
 const rows=new Map(old?.rows.map(r=>[r.t,r])),candles=new Map(old?.candles.map(c=>[c.asset+':'+c.t,c])),conflicts:string[]=[];
 for(const raw of incoming.rows){const row=trustedRailway?raw:{...raw,source:raw.source==='railway'?'browser' as const:raw.source,finalVersion:undefined};rows.set(row.t,await preferMarketRow(rows.get(row.t),row));}
 for(const c of incoming.candles){const id=c.asset+':'+c.t,previous=candles.get(id),result=preferMarketCandle(previous,c);
  // Readback adopts the server's metadata for identical, equally reliable OHLCV.
  // The server still keeps its existing canonical candle on equal-quality writes.
  const equalQuality=previous&&candleScore(previous).every((v,i)=>v===candleScore(c)[i]);
  candles.set(id,canonicalCandles&&equalQuality&&!result.conflict?c:result.candle);if(result.conflict)conflicts.push(id);
 }
 return {content:marketContent({...emptyMarketBlock(incoming.base),rows:[...rows.values()],candles:[...candles.values()]}),conflicts};
}
