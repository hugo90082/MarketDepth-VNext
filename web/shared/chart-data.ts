import { depth, imbalance, type Asset, type Candle, type SpotRow, type Venue } from './model';
import type { Interval } from './contract';
import {viewChoice} from './history-view';

/** One depth value per K-line period. Average the sampled USD bid/ask totals
 * before calculating imbalance, so large books carry their proper weight.
 * An absent or null 30-second sample leaves that period blank. */
export function depthRatioBuckets(rows: SpotRow[], asset: Asset, venue: Venue, zones: number[], interval: Interval, from: number, to: number): { t: number; value: number | null }[] {
 const byTime = new Map(rows.map(row => [row.t, row]));
 const byBucket=new Map(rows.filter(r=>r.bucket?.interval===interval).map(r=>[r.t,r.bucket!]));
 const cadence=rows.some(row=>row.cadence===60000)?60000:30000;
 const result: { t: number; value: number | null }[] = [];
 const first = Math.floor(from / interval) * interval, last = Math.floor(to / interval) * interval;
 for (let t = first; t <= last; t += interval) {
  const bucket=byBucket.get(t);
  if(bucket){const ai=['BTC','ETH','SOL'].indexOf(asset),vi=['binance','coinbase','kraken','bitfinex','all4'].indexOf(venue),choice=viewChoice(zones),pair=bucket.values[vi]?.[ai]?.[choice];result.push({t,value:pair?imbalance(pair[0],pair[1]):null});continue;}
  const end = Math.min(t + interval, Math.floor(to / cadence) * cadence + cadence);
  let bid = 0, ask = 0, count = 0, complete = true;
  for (let sample = t; sample < end; sample += cadence) {
   const part = depth(byTime.get(sample), asset, venue, zones);
   if (part.bid === null || part.ask === null) { complete = false; break; }
   bid += part.bid; ask += part.ask; count++;
  }
  result.push({ t, value: complete && count ? imbalance(bid, ask) : null });
 }
 return result;
}
export function validCandle(c:Candle):boolean {
 return !!c&&Number.isSafeInteger(c.t)&&c.t>=0&&[c.o,c.h,c.l,c.c,c.v].every(Number.isFinite)&&Math.min(c.o,c.h,c.l,c.c)>0&&c.v>=0&&c.h>=Math.max(c.o,c.c,c.l)&&c.l<=Math.min(c.o,c.c,c.h);
}
/** Cached/rest/live inputs must satisfy the chart's strict unique-time contract. */
export function chartCandles<T extends Candle>(input:T[]):T[]{
 const byTime=new Map<number,T>();for(const c of input)if(validCandle(c))byTime.set(c.t,c);
 return [...byTime.values()].sort((a,b)=>a.t-b.t);
}
export function priceWindowChange(candles:Candle[],from:number,interval:Interval):number|null{
 const first=candles[0],last=candles.at(-1);
 return first&&last&&first.t<=Math.ceil(from/interval)*interval?(last.c-first.o)/first.o:null;
}
export function candleChange(before:Candle[],after:Candle[]):'none'|'last'|'all'{
 if(!before.length||after.length<before.length||after.length>before.length+1)return 'all';
 if(after.at(-1)!.t<before.at(-1)!.t)return 'all';
 const same=(a:Candle,b:Candle)=>a.t===b.t&&a.o===b.o&&a.h===b.h&&a.l===b.l&&a.c===b.c;
 const prefix=after.length===before.length?after.length-1:before.length;
 for(let i=0;i<prefix;i++)if(!same(before[i],after[i]))return 'all';
 return after.length===before.length&&same(before.at(-1)!,after.at(-1)!)?'none':'last';
}
/** Time points can disappear during cache/live replacement. Never ask the
 * library to resolve a visible time range until both endpoints resolve. */
export function visibleLogicalRange(from:number,to:number,resolve:(seconds:number)=>number|null):{from:number;to:number}|null{
 if(!Number.isFinite(from)||!Number.isFinite(to)||from>=to)return null;
 const left=resolve(from/1000),right=resolve(to/1000);
 return left===null||right===null?null:{from:left,to:Math.max(left+1,right)};
}
export function commonChartTimeline(from:number,to:number,interval:Interval){const times:number[]=[];for(let t=Math.floor(from/interval)*interval;t<=Math.floor(to/interval)*interval;t+=interval)times.push(t/1000);return times;}
