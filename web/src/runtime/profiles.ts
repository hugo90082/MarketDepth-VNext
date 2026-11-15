import {ASSETS} from '../../shared/model';
import {bookKey,readProfileBook,observeProfileBooks,setProfileBookInterest,type ProfileBookView} from '../../shared/profile-books';
import {demandSources,profileKey,validProfileDemand,commonProfileTick,type ProfileDemand,type ProfileFrame,type ProfileQuality,type ProfileLevel,type ProfileTotal,type ProfileSource} from '../../shared/order-book-profile';

import {LargeOrderIndex} from './large-order-index';
import type {RawBook} from '../monitor/depth-engine/order-book';

type Entry={large:LargeOrderIndex;generation?:number;fallback?:boolean;continuous?:boolean};
type Source={source:ProfileSource;key:string;view:ProfileBookView|undefined;entry:Entry;quality:ProfileQuality};
const priceKey=(price:number)=>Number(price.toFixed(8));
function complete(view:ProfileBookView,side:'bid'|'ask',low:number,high:number){return !!view.complete||!!view.bounds&&(side==='bid'?low>=view.bounds.bid:high<=view.bounds.ask);}
function levels(sources:Source[],low:number,high:number):ProfileLevel[]{
 const result=new Map<number,ProfileLevel>();
 for(const s of sources){if(!s.quality.available)continue;for(const side of ['bid','ask'] as const)for(const value of s.entry.large.levels(side,low,high)){const price=priceKey(value.price);let level=result.get(price);if(!level){level={price,bid:0,ask:0,bidComplete:true,askComplete:true,parts:{}};result.set(price,level);}level[side]+=value.amount;const part=level.parts[s.source]??{bid:0,ask:0,bidObservedAt:null,askObservedAt:null,bidComplete:true,askComplete:true};part[side]=value.amount;part[side==='bid'?'bidObservedAt':'askObservedAt']=value.observedAt??null;level.parts[s.source]=part;}}
 for(const level of result.values())for(const s of sources){const bid=s.quality.available&&complete(s.view!,'bid',level.price,level.price),ask=s.quality.available&&complete(s.view!,'ask',level.price,level.price);level.bidComplete&&=bid;level.askComplete&&=ask;const part=level.parts[s.source];if(part){part.bidComplete=bid;part.askComplete=ask;}}
 return [...result.values()].sort((a,b)=>a.price-b.price);
}
function totals(sources:Source[]):ProfileTotal[]{return [1,3,5,10].map(percent=>{
 const bySide={bid:new Map<number,number>(),ask:new Map<number,number>()},covered={bid:true,ask:true};
 for(const s of sources){const mid=s.quality.mid;if(!s.quality.available||mid===null){covered.bid=false;covered.ask=false;continue;}const low=mid*(1-percent/100),high=mid*(1+percent/100);
  for(const side of ['bid','ask'] as const){covered[side]&&=complete(s.view!,side,low,high);for(const v of s.entry.large.levels(side,low,high)){const price=priceKey(v.price);bySide[side].set(price,(bySide[side].get(price)??0)+v.amount);}}
 }
 const amount=(side:'bid'|'ask')=>bySide[side].size?[...bySide[side].values()].reduce((a,b)=>a+b,0):covered[side]?0:null;
 const bid=amount('bid'),ask=amount('ask');return {percent,bid,ask,bidCount:bid===null?null:bySide.bid.size,askCount:ask===null?null:bySide.ask.size,bidComplete:covered.bid,askComplete:covered.ask,bidShare:bid!==null&&ask!==null&&bid+ask>0?bid/(bid+ask):null};
});}
export class ProfileManager {
 private demands:ProfileDemand[]=[];private entries=new Map<string,Entry>();private fallback=new Map<string,ProfileBookView>();
 private cache=new Map<string,{signature:string;frame:ProfileFrame}>();private unsubscribe:()=>void;private stopped=false;
 private queued=new Set<string>();private running=false;private priorityRuns=0;private activeBuild:{key:string;generation:number;fallback:boolean}|null=null;private costs:number[]=[];
 constructor(private emit:(frame:ProfileFrame)=>void,private now:()=>number=Date.now){
  for(const asset of ASSETS)for(const [source,market]of [['binance','spot'],['coinbase','spot'],['binance','usdm']] as const)this.entries.set(bookKey(source,asset,market),{large:new LargeOrderIndex(asset)});
  setProfileBookInterest(this.entries.keys());
  this.unsubscribe=observeProfileBooks(e=>{const entry=this.entries.get(e.key);if(!entry)return;const view=this.view(e.key);
   if(e.type==='reset'){entry.continuous=!!e.continuous&&entry.large.ready;if(entry.continuous)entry.large.cancelRebuild();else entry.large.invalidate();if(entry.generation!==(view?.generation??0)||entry.fallback!==!!view?.fallback)entry.large.cancelRebuild();this.enqueue(e.key);}
   else if(e.type==='patch'){entry.large.patch(e.patches??[],this.now());if(entry.large.dirty>=20000&&!entry.large.building){entry.continuous=true;this.enqueue(e.key);}}
   else {if(!readProfileBook(e.key)?.ready){this.fallback.delete(e.key);entry.large.cancelRebuild();entry.large.invalidate();}this.pulse();}
  });
  for(const key of this.entries.keys())this.enqueue(key);
 }
 private view(key:string){const live=readProfileBook(key);return live?.ready?live:this.fallback.get(key)??live;}
 setDemands(demands:ProfileDemand[]){this.demands=demands.filter(validProfileDemand).slice(0,128);if(!this.demands.length)this.cache.clear();for(const [key,entry]of this.entries)if(!entry.large.ready)this.enqueue(key);}
 private enqueue(key:string){const view=this.view(key);if(this.stopped||!view?.ready)return;if(this.activeBuild?.key===key&&this.activeBuild.generation===(view.generation??0)&&this.activeBuild.fallback===!!view.fallback)return;this.queued.add(key);void this.drain();}
 private async drain(){if(this.running||this.stopped)return;this.running=true;
  try{while(this.queued.size&&!this.stopped){const visible=new Set(this.demands.flatMap(d=>demandSources(d).map(s=>bookKey(s,d.asset,d.market))));const oldest=this.queued.values().next().value!,key=this.priorityRuns<2?[...this.queued].find(k=>visible.has(k))??oldest:oldest;this.priorityRuns=visible.has(key)?this.priorityRuns+1:0;this.queued.delete(key);const entry=this.entries.get(key)!,view=this.view(key);if(!view?.ready)continue;
    const generation=view.generation??0,fallback=!!view.fallback;this.activeBuild={key,generation,fallback};
    if(entry.generation!==generation||entry.fallback!==fallback)entry.large.cancelRebuild();
    try{const snapshot={bids:[...view.bids] as [number,number][],asks:[...view.asks] as [number,number][]};const tracked=await entry.large.rebuild(view,snapshot,!!entry.continuous,this.now());const current=this.view(key);this.activeBuild=null;if(this.stopped)break;if(!current?.ready||(current.generation??0)!==generation||!!current.fallback!==fallback){entry.large.cancelRebuild();this.enqueue(key);continue;}if(!tracked){entry.continuous=entry.large.ready;this.queued.add(key);continue;}entry.generation=generation;entry.fallback=fallback;entry.continuous=true;this.pulse();if(entry.large.dirty>=20000)this.queued.add(key);}
    catch{entry.large.cancelRebuild();this.pulse();if(this.view(key)?.ready)this.queued.add(key);await new Promise(resolve=>setTimeout(resolve,100));}
   }}finally{this.activeBuild=null;this.running=false;}
 }
 rebase(exchange:string,asset:string,book:RawBook){
  const source=exchange==='Binance'?'binance':exchange==='Coinbase'?'coinbase':null;if(!source)return;const key=bookKey(source,asset);
  if(book.acquisitionMode!=='web-feed'&&!readProfileBook(key)?.ready){const view:ProfileBookView={bids:new Map(book.bids),asks:new Map(book.asks),ready:true,activityAt:book.capturedAt,updateAt:book.capturedAt,snapshotAt:book.capturedAt,generation:book.capturedAt,tick:book.tickSize??0,bounds:book.verifiedBounds??{bid:book.bids.at(-1)?.[0]??Infinity,ask:book.asks.at(-1)?.[0]??0},complete:false,fallback:true};this.fallback.set(key,view);const entry=this.entries.get(key)!;entry.continuous=false;entry.large.invalidate();this.enqueue(key);}
 }
 pulse(){if(this.stopped||!this.demands.length)return;const started=performance.now(),now=this.now(),computed=new Map<string,ProfileFrame>(),sharedTotals=new Map<string,ProfileTotal[]>();
  for(const d of this.demands){const sources:Source[]=demandSources(d).map(source=>{const key=bookKey(source,d.asset,d.market),view=this.view(key),entry=this.entries.get(key)!,age=view?now-view.activityAt:Infinity;
    const available=!!view?.ready&&age>=0&&age<=60000&&entry.large.ready&&entry.fallback===!!view.fallback&&entry.generation===(view.generation??0),mid=available?entry.large.mid:null,valid=available&&mid!==null;
    return {source,key,view,entry,quality:{source,available:valid,phase:valid?(view!.fallback?'備援快照':view!.phase??'已同步'):entry.large.building?'建立大額價位索引中':age>60000&&view?'資料延遲':view?.phase??'初始化／重連中',activityAt:view?.activityAt??0,updateAt:view?.updateAt??0,snapshotAt:view?.snapshotAt??0,eventAt:view?.eventAt,generation:view?.generation??0,version:entry.large.version,mid:valid?mid:null,tick:view?.tick??0,fallback:!!view?.fallback}};
   });
   const tick=commonProfileTick(sources.map(s=>s.view?.tick??0)),key=profileKey(d,tick);let frame=computed.get(key);
   if(!frame){const values=levels(sources,d.low,d.high),qualities=sources.map(s=>s.quality),scope=[d.asset,d.market??'spot',d.mode].join(':');let sums=sharedTotals.get(scope);if(!sums){sums=totals(sources);sharedTotals.set(scope,sums);}const signature=JSON.stringify([qualities,values,sums]),cached=this.cache.get(key);
    frame={type:'profile-frame',...d,sampleAt:now,levels:cached?.signature===signature?cached.frame.levels:values,totals:sums,sources:qualities,max:values.reduce((max,v)=>Math.max(max,v.bid,v.ask),0)};this.cache.delete(key);this.cache.set(key,{signature,frame});while(this.cache.size>24)this.cache.delete(this.cache.keys().next().value!);computed.set(key,frame);
   }this.emit({...frame,id:d.id,revision:d.revision,asset:d.asset,mode:d.mode,market:d.market??'spot',sampleAt:now});
  }this.costs.push(performance.now()-started);if(this.costs.length>512)this.costs.shift();
 }
 stop(){this.stopped=true;this.unsubscribe();setProfileBookInterest([]);for(const entry of this.entries.values()){entry.large.cancelRebuild();entry.large.invalidate();}this.entries.clear();this.queued.clear();this.cache.clear();this.fallback.clear();this.demands=[];}
 diagnostics(){const sorted=[...this.costs].sort((a,b)=>a-b);return {demands:this.demands.length,cache:this.cache.size,queued:this.queued.size,p95:sorted[Math.floor(sorted.length*.95)]??0,indexes:[...this.entries].map(([key,e])=>{const book=this.view(key);return {key,generation:e.generation,ready:e.large.ready,dirty:e.large.dirty,rebuilds:e.large.rebuilds,building:e.large.building,candidates:e.large.count,levels:(book?.bids.size??0)+(book?.asks.size??0),activityAt:book?.activityAt??0,updateAt:book?.updateAt??0};})};}
}
