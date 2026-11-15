import {validIndicatorHistory,type IndicatorBar,type IndicatorHistoryRequest} from '../../shared/technical-indicators';
import {retryAfterMs} from '../../shared/retry';
type Request=IndicatorHistoryRequest&{key:string};
type Cache={bars:Map<number,IndicatorBar>;empty:{from:number;to:number}[]};
export class IndicatorWarmup{
 private caches=new Map<string,Cache>();private jobs=new Map<string,{refs:Set<string>;promise:Promise<IndicatorBar[]>;abort:AbortController}>();
 private turn:Promise<unknown>=Promise.resolve();private nextAt=0;private cooling=0;private stopped=false;
 constructor(private local:(r:IndicatorHistoryRequest)=>Promise<IndicatorBar[]>,private fetcher:typeof fetch=(...args)=>fetch(...args),private now=Date.now,private sleep=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms))){}
 cancel(key:string){for(const job of this.jobs.values())if(job.refs.delete(key)&&!job.refs.size)job.abort.abort();}
 stop(){this.stopped=true;for(const j of this.jobs.values())j.abort.abort();this.jobs.clear();this.caches.clear();}
 get(r:Request):Promise<IndicatorBar[]>{
  if(!validIndicatorHistory(r)||typeof r.key!=='string'||r.key.length>200)return Promise.reject(new Error('指標前置資料範圍無效。'));
  const id=[r.asset,r.interval,r.from,r.to].join(':');const existing=this.jobs.get(id);if(existing&&!existing.abort.signal.aborted){existing.refs.add(r.key);return existing.promise;}
  const job={refs:new Set([r.key]),abort:new AbortController(),promise:Promise.resolve([] as IndicatorBar[])};
  job.promise=this.load(r,job.abort.signal).finally(()=>{if(this.jobs.get(id)===job)this.jobs.delete(id);});this.jobs.set(id,job);return job.promise;
 }
 private async load(r:Request,signal:AbortSignal){
  const id=r.asset+':'+r.interval;let cache=this.caches.get(id);if(!cache){cache={bars:new Map(),empty:[]};this.caches.set(id,cache);}else{this.caches.delete(id);this.caches.set(id,cache);}
  while(this.caches.size>12)this.caches.delete(this.caches.keys().next().value!);
  const result=new Map<number,IndicatorBar>(),absent=new Set<number>();
  const keep=(c:IndicatorBar)=>{if(c.closed&&c.complete!==false&&Number.isFinite(c.c)&&c.c>0&&c.t>=r.from&&c.t<r.to&&c.t%r.interval===0){result.set(c.t,c);cache!.bars.delete(c.t);cache!.bars.set(c.t,c);}};
  for(const c of cache.bars.values())if(c.t>=r.from&&c.t<r.to)result.set(c.t,c);
  for(const c of await this.local(r))keep(c);
  const valid=()=>!this.stopped&&!signal.aborted;
  const missing=()=>{for(let t=r.from;t<r.to;t+=r.interval)if(!result.has(t)&&!absent.has(t)&&!cache!.empty.some(g=>g.from<=t&&t<g.to))return t;return null;};
  while(valid()&&missing()!==null){
   const task=this.turn.catch(()=>{}).then(async()=>{
    if(!valid())throw new DOMException('aborted','AbortError');
    // Another overlapping view may have populated this range while this request waited.
    for(const c of cache!.bars.values())if(c.t>=r.from&&c.t<r.to)result.set(c.t,c);
    const from=missing();if(from===null)return;
    let to=Math.min(r.to,from+499*r.interval);for(let t=from+r.interval;t<to;t+=r.interval)if(result.has(t)){to=t;break;}
    await this.sleep(Math.max(0,this.nextAt-this.now(),this.cooling-this.now()));if(!valid())throw new DOMException('aborted','AbortError');
    this.nextAt=this.now()+500;
    const unit=r.interval>=3600000?`${r.interval/3600000}h`:`${r.interval/60000}m`;
    const response=await this.fetcher(`https://fapi.binance.com/fapi/v1/klines?symbol=${r.asset}USDT&interval=${unit}&startTime=${from}&endTime=${to-1}&limit=${(to-from)/r.interval}`,{credentials:'omit',signal:AbortSignal.any([signal,AbortSignal.timeout(15000)])});
    if(!response.ok){if(response.status===429||response.status===418)this.cooling=this.now()+retryAfterMs(response.headers.get('retry-after'),this.now(),30000);throw new Error(`指標 K 線補讀失敗（HTTP ${response.status}），稍後重試。`);}
    const rows=await response.json();if(!Array.isArray(rows))throw new Error('指標 K 線格式無效。');
    const found=new Set<number>();let last=-1;
    for(const row of rows){if(!Array.isArray(row)||row.length!==12)throw new Error('指標 K 線格式無效。');const [t,o,h,l,c,v]=row.slice(0,6).map(Number);if(![t,o,h,l,c,v].every(Number.isFinite)||t<=last||t%r.interval||t<from||t>=to||Math.min(o,h,l,c)<=0||v<0||h<Math.max(o,c,l)||l>Math.min(o,c,h))throw new Error('指標 K 線格式無效。');last=t;if(t+r.interval<=this.now()){keep({t,c,closed:true,complete:true});found.add(t);}}
    // Empty historical slots are remembered as unknown, never manufactured as candles.
    for(let t=from;t<to;t+=r.interval)if(!found.has(t)&&!result.has(t)){absent.add(t);const prior=cache!.empty.at(-1);if(prior?.to===t)prior.to=t+r.interval;else cache!.empty.push({from:t,to:t+r.interval});}
    while(cache!.bars.size>24000)cache!.bars.delete(cache!.bars.keys().next().value!);if(cache!.empty.length>64)cache!.empty.splice(0,cache!.empty.length-64);
   });this.turn=task;await task;
  }
  if(!valid())throw new DOMException('aborted','AbortError');while(cache.bars.size>24000)cache.bars.delete(cache.bars.keys().next().value!);return [...result.values()].sort((a,b)=>a.t-b.t);
 }
}
