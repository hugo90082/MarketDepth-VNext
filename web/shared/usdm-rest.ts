import {createReservationQueue} from './reservation-queue';
import {retryAfterMs} from './retry';
import type {UsdmSnapshot} from './usdm-book';
export type UsdmMarket={symbol:string;tick:number;contractType:'PERPETUAL';quote:'USDT'};
export class UsdmHttpError extends Error {constructor(message:string,public status:number,public retryAt=0){super(message);}}
export class UsdmRest {
 private state={nextAllowedAt:0,blockedUntil:0};private reserve=createReservationQueue(this.state,()=>this.now());
 private meta:Map<string,UsdmMarket>|null=null;private metaTask:Promise<Map<string,UsdmMarket>>|null=null;private metaAt=0;private perMinute=2400;
 private used=0;private window=0;private pending=new Map<string,Promise<UsdmSnapshot>>();
 constructor(private fetcher:typeof fetch=(...args)=>fetch(...args),private now=Date.now){}
 get blockedUntil(){return this.state.blockedUntil;}
 async json(path:string,weight:number,signal:AbortSignal){
  const window=Math.floor(this.now()/60000);if(window!==this.window){this.window=window;this.used=0;}
  // Leave half of the official allowance for existing futures K-line work and other clients.
  const budget=this.perMinute*.5;if(this.used+weight>budget)this.state.nextAllowedAt=Math.max(this.state.nextAllowedAt,(window+1)*60000);
  await this.reserve(Math.ceil(60000/Math.max(1,budget)*weight),1,signal);this.used+=weight;
  const response=await this.fetcher('https://fapi.binance.com'+path,{signal,credentials:'omit',cache:'no-store'});
  const header=Number(response.headers.get('x-mbx-used-weight-1m'));if(Number.isFinite(header)&&header>0)this.used=Math.max(this.used,header);
  if(!response.ok){const delay=response.status===418?120000:60000;if(response.status===429||response.status===418)this.state.blockedUntil=Math.max(this.state.blockedUntil,this.now()+retryAfterMs(response.headers.get('retry-after'),this.now(),delay));throw new UsdmHttpError('合約上游 HTTP '+response.status,response.status,this.state.blockedUntil);}
  return response.json() as Promise<any>;
 }
 markets(signal:AbortSignal):Promise<Map<string,UsdmMarket>>{
  if(this.meta&&this.now()-this.metaAt<6*3600000)return Promise.resolve(this.meta);if(this.metaTask)return this.metaTask;
  const task=this.json('/fapi/v1/exchangeInfo',1,signal).then(data=>{
   const limit=data.rateLimits?.find((r:any)=>r.rateLimitType==='REQUEST_WEIGHT'&&r.interval==='MINUTE'&&r.intervalNum===1)?.limit;if(Number.isFinite(limit)&&limit>0)this.perMinute=limit;
   const markets=new Map<string,UsdmMarket>();for(const item of data.symbols??[]){if(!['BTCUSDT','ETHUSDT','SOLUSDT'].includes(item.symbol)||item.status!=='TRADING'||item.contractType!=='PERPETUAL'||item.quoteAsset!=='USDT')continue;const tick=Number(item.filters?.find((f:any)=>f.filterType==='PRICE_FILTER')?.tickSize);if(Number.isFinite(tick)&&tick>0)markets.set(item.symbol,{symbol:item.symbol,tick,contractType:'PERPETUAL',quote:'USDT'});}
   this.meta=markets;this.metaAt=this.now();return markets;
  }).finally(()=>{if(this.metaTask===task)this.metaTask=null;});this.metaTask=task;return task;
 }
 snapshot(symbol:string,signal:AbortSignal){const existing=this.pending.get(symbol);if(existing)return existing;const task=this.json('/fapi/v1/depth?symbol='+symbol+'&limit=1000',20,signal).finally(()=>{if(this.pending.get(symbol)===task)this.pending.delete(symbol);});this.pending.set(symbol,task);return task as Promise<UsdmSnapshot>;}
}
