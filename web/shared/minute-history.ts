import {ASSETS,type Pair} from './model';
import {CONTRACT,emptyRow,type StoredRow,type StoredCandle} from './contract';

export const RESEARCH_CADENCE=60_000;
export const MINUTE_CONVERSION='MD-MINUTE-AVERAGE-1';
export const RESEARCH_RANGES=[1,4,8,12,24,48,72,120,168,336,720,2160,4320] as const;
export const RESEARCH_INTERVALS=[60_000,300_000,900_000,3_600_000,14_400_000,43_200_000] as const;
export function defaultInterval(hours:number){return hours>=4320?43_200_000:hours>=2160?14_400_000:hours>=720?3_600_000:hours>=336?900_000:60_000;}
export function rangeLabel(hours:number){return ({336:'2W',720:'1M',2160:'3M',4320:'6M'} as Record<number,string>)[hours]??(hours>24?`${hours/24}D`:`${hours}H`);}

/** Legacy sealed rows, including null, are averaged only across both mandatory
 * half slots. A native minute sample must never be mistaken for half a minute. */
export function minuteRows(input:StoredRow[]):StoredRow[]{
 const groups=new Map<number,Map<number,StoredRow>>();
 for(const r of input){const base=Math.floor(r.t/RESEARCH_CADENCE)*RESEARCH_CADENCE;const g=groups.get(base)??new Map();const old=g.get(r.t);if(!old||old.source!=='railway'||r.source==='railway')g.set(r.t,r);groups.set(base,g);}
 return [...groups].sort(([a],[b])=>a-b).map(([t,g])=>{
  const left=g.get(t),right=g.get(t+30_000);
  if(left?.cadence===RESEARCH_CADENCE)return left;
  const observed=[left,right].filter((r):r is StoredRow=>!!r);
  const result:StoredRow={...emptyRow(t),source:observed.every(r=>r.source==='railway')?'railway':observed.some(r=>r.source==='recent')?'recent':'browser',format:CONTRACT.datasetFormat,cadence:RESEARCH_CADENCE,a:Math.max(left?.a??t,right?.a??t),issues:[...(left?.issues??[]),...(right?.issues??[])]};
  if(observed.every(r=>Number.isSafeInteger(r.finalVersion)))result.finalVersion=Math.min(...observed.map(r=>r.finalVersion!));
  result.d=result.d.map((v,vi)=>v.map((a,ai)=>a.map((_,zi)=>[0,1].map(side=>{const x=left?.d[vi][ai][zi][side],y=right?.d[vi][ai][zi][side];return typeof x==='number'&&typeof y==='number'?(x+y)/2:null;}) as Pair)));
  if(!left||!right)result.issues!.push('舊 30 秒資料缺少必要半格');
  if(left?.captured&&right?.captured)result.captured=left.captured.map((v,vi)=>v.map((ok,ai)=>ok&&!!right.captured?.[vi][ai]));
  if(left?.quality&&right?.quality)result.quality={version:'FORMAL_AVAILABLE_V2',books:left.quality.books.map((v,vi)=>v.map((q,ai)=>{const other=right.quality?.books[vi][ai];return q&&other?{...q,capturedAt:Math.min(q.capturedAt,other.capturedAt),bidBps:Math.min(q.bidBps,other.bidBps),askBps:Math.min(q.askBps,other.askBps),complete:q.complete.map((ok,zi)=>ok&&other.complete[zi])}:null;}))};
  return result;
 });
}
export function minuteCandles(input:StoredCandle[]):StoredCandle[]{
 const result=new Map<string,StoredCandle>();
 for(const asset of ASSETS){const own=input.filter(c=>c.asset===asset),halves=new Map(own.filter(c=>c.interval===30_000).map(c=>[c.t,c]));
  for(const [t,a]of halves){if(t%60_000)continue;const b=halves.get(t+30_000);if(!b||!a.complete||!a.closed||!b.complete||!b.closed)continue;result.set(asset+':'+t,{asset,interval:60_000,t,o:a.o,h:Math.max(a.h,b.h),l:Math.min(a.l,b.l),c:b.c,v:a.v+b.v,closed:true,complete:true,observedAt:Math.max(a.observedAt??0,b.observedAt??0)});}
  for(const c of own.filter(c=>c.interval===60_000))if(c.complete&&c.closed||!result.has(asset+':'+c.t))result.set(asset+':'+c.t,c);
 }
 return [...result.values()].sort((a,b)=>a.t-b.t);
}
