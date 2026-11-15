import type { Asset } from './model';
import type { StoredCandle } from './contract';
const MINUTE = 60_000;
const MAX_KLINES = 1500;

export function nextKlineRequest(from:number,end:number,known:ReadonlySet<number>,refreshLive:boolean){
 if(refreshLive)return {startTime:end,endTime:end+MINUTE-1,limit:1};
 let first:number|undefined,last:number|undefined;
 for(let t=from;t<end;t+=MINUTE){
  if(first!==undefined&&t-first>=MAX_KLINES*MINUTE)break;
  if(!known.has(t)){first??=t;last=t;}
 }
 return first===undefined||last===undefined?null:{startTime:first,endTime:last+MINUTE-1,limit:(last-first)/MINUTE+1};
}

export function parseKlines(raw:unknown,asset:Asset,now:number):StoredCandle[]{
 if(!Array.isArray(raw))throw new Error('INVALID_KLINES');
  const rows=raw.map((r:any):StoredCandle=>{if(!Array.isArray(r)||r.length!==12)throw new Error('INVALID_KLINE');const [t,o,h,l,c,v]=r.slice(0,6).map(Number);if(![t,o,h,l,c,v].every(Number.isFinite)||t%60000||Math.min(o,h,l,c)<=0||v<0||h<Math.max(o,c,l)||l>Math.min(o,c,h))throw new Error('INVALID_KLINE');return {asset,interval:60000,t,o,h,l,c,v,closed:Number(r[6])<now,complete:true,source:'binance-usdm',observedAt:Math.min(now,t+60000)};});
 if(rows.some((c,i)=>i>0&&c.t<=rows[i-1].t))throw new Error('UNSORTED_KLINES');return rows;
}
