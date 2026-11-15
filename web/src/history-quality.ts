import { CADENCE, depth, ASSETS, VENUES, type Asset, type Venue } from '../shared/model';
import type { Span, StoredRow } from '../shared/contract';
import {viewChoice} from '../shared/history-view';

export const HISTORY_BLOCK = 900_000;
export type IndexedChunk = {id:string;sha256:string;startTsMs:number;endTsMs:number;cached:boolean};
export type ComparisonStatus = {
 ok:true;eligibleTo:number;from:number;indexVersion:number|null;indexed:Span|null;oldestAvailableTsMs:number|null;
 chunks:IndexedChunk[];cacheComplete:boolean;lastCompleted:{id:string;from:number;to:number;at:number;indexVersion:number|null}|null;
};
export type VerifiedChunk = {id:string;sha256:string;startTsMs:number;endTsMs:number;rowTimes:number[]};
export type VerifiedBlock = {base:number;signature:string;confirmedMask:number;presentMask:number;checkedAt:number;indexVersion:number|null};
export type Quality = {expected:number;available:number;fullCoverage:number;partialCoverage:number;unknownCoverage:number;unverified:number;backendValid:number;backendNull:number;backendZero:number;backendAbsent:number;localLost:number;unsealed:number;outsideRetention:number;verifiedThrough:number|null;checkedAt:number|null;indexVersion:number|null};

export const blockBase=(t:number)=>Math.floor(t/HISTORY_BLOCK)*HISTORY_BLOCK;
export function statusAfterCompletedJob(verified:ComparisonStatus,now:number,hours:number):ComparisonStatus{
 const eligibleTo=Math.floor((now-HISTORY_BLOCK)/HISTORY_BLOCK)*HISTORY_BLOCK;
 return {...verified,from:Math.ceil((now-hours*3600000)/CADENCE)*CADENCE,eligibleTo,
  cacheComplete:verified.cacheComplete&&eligibleTo<=verified.eligibleTo};
}
const bit=(t:number)=>1<<Math.floor((t-blockBase(t))/CADENCE);
export function blockSignature(chunks:IndexedChunk[],base:number){
 return chunks.filter(c=>c.startTsMs<base+HISTORY_BLOCK&&c.endTsMs>base)
  .map(c=>`${c.id}:${c.sha256}:${c.startTsMs}:${c.endTsMs}`).sort().join('|')||'empty';
}
export function recordBlocks(previous:VerifiedBlock[],status:ComparisonStatus,confirmed:Span[],chunks:VerifiedChunk[],rows:StoredRow[],checkedAt:number):VerifiedBlock[]{
 if(!status.indexed)return previous;
 const out=new Map(previous.map(b=>[b.base,b]));
 const known=new Map(chunks.map(c=>[c.id+':'+c.sha256,c]));
 const present=new Set<number>();
 for(const c of status.chunks){const stored=known.get(c.id+':'+c.sha256);if(stored)for(const t of stored.rowTimes)present.add(t);}
 const rowMap=new Map(rows.map(r=>[r.t,r]));
 for(const span of confirmed)for(let t=Math.ceil(span.from/CADENCE)*CADENCE;t+CADENCE<=span.to;t+=CADENCE){
  if(t<status.indexed.from||t+CADENCE>status.indexed.to)continue;
  const base=blockBase(t),signature=blockSignature(status.chunks,base),old=out.get(base),same=old?.signature===signature;
  const mask=bit(t),hasRow=present.has(t)&&(rowMap.get(t)??rowMap.get(Math.floor(t/60000)*60000))?.source==='railway';
  // A delivered chunk is acknowledged only after its rows survive a readback.
  // If the expected row has disappeared, leave this slot unconfirmed.
  if(present.has(t)&&!hasRow)continue;
  out.set(base,{base,signature,confirmedMask:(same?old.confirmedMask:0)|mask,
   presentMask:((same?old.presentMask:0)&~mask)|(present.has(t)?mask:0),checkedAt,indexVersion:status.indexVersion});
 }
 return [...out.values()].sort((a,b)=>a.base-b.base);
}
export function assessHistory(rows:StoredRow[],from:number,to:number,asset:Asset,venue:Venue,zones:number[],status:ComparisonStatus|null,blocks:VerifiedBlock[]):Quality{
 const result:Quality={expected:0,available:0,fullCoverage:0,partialCoverage:0,unknownCoverage:0,unverified:0,backendValid:0,backendNull:0,backendZero:0,backendAbsent:0,localLost:0,unsealed:0,outsideRetention:0,verifiedThrough:null,checkedAt:null,indexVersion:null};
 const rowMap=new Map(rows.map(r=>[r.t,r])),blockMap=new Map(blocks.map(b=>[b.base,b]));
 const sealed=status?.eligibleTo??Math.floor((to-HISTORY_BLOCK)/HISTORY_BLOCK)*HISTORY_BLOCK;
 if(rows.some(r=>r.bucket)){
  const ai=ASSETS.indexOf(asset),vi=venue==='all4'?4:VENUES.indexOf(venue),choice=viewChoice(zones);let verified=0;
  result.expected=Math.max(0,Math.ceil(to/60000)-Math.ceil(from/60000));result.unsealed=Math.max(0,Math.ceil(to/60000)-Math.ceil(Math.max(from,sealed)/60000));
  for(const r of rows){const s=r.bucket?.stats[vi]?.[ai]?.[choice];if(!s)continue;result.available+=s.available;result.fullCoverage+=s.full;result.partialCoverage+=s.partial;result.unknownCoverage+=s.unknown;verified+=s.final;result.backendValid+=s.backendValid;result.backendNull+=s.backendNull;result.backendZero+=s.backendZero;}
  result.unverified=Math.max(0,result.expected-result.unsealed-verified);result.indexVersion=status?.indexVersion??null;return result;
 }
 let contiguous=true;
 const cadence=rows.some(row=>row.cadence===60000)?60000:CADENCE;
 for(let t=Math.ceil(from/cadence)*cadence;t<to;t+=cadence){
  result.expected++;const row=rowMap.get(t),value=depth(row,asset,venue,zones);
  if(value.ratio!==null){
   result.available++;
   const ai=ASSETS.indexOf(asset),venues=venue==='all4'?[0,1,2,3]:[VENUES.indexOf(venue)];
   const metadata=venues.map(vi=>row?.quality?.books[vi]?.[ai]);
   if(metadata.every(q=>q&&zones.every(zi=>q.complete[zi])))result.fullCoverage++;
   else if(metadata.some(q=>q&&zones.some(zi=>!q.complete[zi])))result.partialCoverage++;
   else result.unknownCoverage++;
  }
  if(t>=sealed){result.unsealed++;continue;}
  if(status?.oldestAvailableTsMs!==null&&status?.oldestAvailableTsMs!==undefined&&t<status.oldestAvailableTsMs){result.outsideRetention++;continue;}
  const block=blockMap.get(blockBase(t)),verified=!!status?.indexed&&status.indexed.from<=t&&status.indexed.to>=t+CADENCE&&
   !!block&&block.signature===blockSignature(status.chunks,block.base)&&!!(block.confirmedMask&bit(t));
  if(!verified){result.unverified++;contiguous=false;continue;}
  if(contiguous)result.verifiedThrough=t+CADENCE;
  result.checkedAt=Math.max(result.checkedAt??0,block!.checkedAt);result.indexVersion=block!.indexVersion;
  if(!(block!.presentMask&bit(t))){result.backendAbsent++;continue;}
  if(row?.source!=='railway'){result.localLost++;continue;}
  const ai=ASSETS.indexOf(asset),selected=venue==='all4'?[0,1,2,3]:[VENUES.indexOf(venue)];
  if(selected.some(vi=>zones.some(zi=>row.d[vi][ai][zi].some(n=>n===null))))result.backendNull++;
  if(value.ratio!==null)result.backendValid++;
  else if(value.bid!==null&&value.ask!==null)result.backendZero++;
 }
 return result;
}
