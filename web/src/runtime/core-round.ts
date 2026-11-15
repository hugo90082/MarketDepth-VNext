import {ASSETS} from '../../shared/model';
import {CONTRACT,emptyRow,type StoredRow} from '../../shared/contract';
import {getBookConnection} from './books';
import {sourceInWindow} from '../../shared/runtime-policy';
import {researchBook} from '../../shared/research-book';
import {emptySource,aggregateRange,type RawBook} from '../monitor/depth-engine/order-book';
import {FIXED_EXCHANGE_QUOTES} from '../monitor/market-ranking';
import {DEPTH_OPTIONS,depthKey,type DepthResponse,type SourceResult} from '../monitor/depth-types';
const EXCHANGES=['Binance','OKX','Bybit','Coinbase','Bitfinex','Kraken'] as const;
const RESEARCH=['Binance','Coinbase','Kraken','Bitfinex'] as const;
type Load=(exchange:typeof EXCHANGES[number],asset:string)=>Promise<{source:SourceResult;book?:RawBook}>;
type Message={type:'row';row:StoredRow;coverage:Record<string,unknown>}|{type:'snapshot';symbol:string;payload:DepthResponse};
export async function collectCoreRound(target:number,monitored:ReadonlySet<string>,load:Load,emit:(message:Message)=>void,waitUntil:(time:number)=>Promise<void>,now:()=>number=Date.now,onBook?:(exchange:string,asset:string,book:RawBook)=>void){
 // A suspended timer cannot manufacture a missed sample on resume.
 if(now()>target+1500)return;
 const row:StoredRow={...emptyRow(target),source:'browser',format:CONTRACT.datasetFormat,captured:RESEARCH.map(()=>ASSETS.map(()=>false)),quality:{version:'FORMAL_AVAILABLE_V2',books:RESEARCH.map(()=>ASSETS.map(()=>null))}};
 const tasks:Promise<void>[]=[],perAsset=new Map<string,Promise<void>[]>(),sources=new Map<string,Map<string,SourceResult>>();let sealed=false;
 for(const asset of ASSETS){
  const byExchange=new Map<string,SourceResult>(),assetTasks:Promise<void>[]=[];sources.set(asset,byExchange);perAsset.set(asset,assetTasks);
  for(const exchange of EXCHANGES){
   if(target%60000!==0&&!monitored.has(asset))continue;
   const vi=RESEARCH.indexOf(exchange as typeof RESEARCH[number]);
   if(vi<0&&!monitored.has(asset))continue;
   const task=load(exchange,asset).then(result=>{
    const late=!!result.book&&!sourceInWindow(result.book.capturedAt,target);
    byExchange.set(exchange,late?{...result.source,feed:result.source.feed+' · 取樣延遲',fallbackReason:'實際取得時間超出研究取樣時窗'}:result.source);
    // Latest profiles may use a genuine late fallback, with its real capture
    // time. Historical sealing below remains strictly unchanged.
    if(result.book)onBook?.(exchange,asset,result.book);
    if(target%60000!==0||vi<0||sealed||!result.book||late)return;
    const ai=ASSETS.indexOf(asset),computed=researchBook(result.book);row.d[vi][ai]=computed.zones;row.captured![vi][ai]=true;row.quality!.books[vi][ai]=computed.quality;
   }).catch(()=>{});
   assetTasks.push(task);if(vi>=0)tasks.push(task);
  }
 }
 await Promise.race([Promise.allSettled(tasks),waitUntil(target+1500)]);
 if(now()<target)await waitUntil(target);
 sealed=true;row.a=now();row.issues=[];
 for(let vi=0;vi<4;vi++)for(let ai=0;ai<3;ai++)if(!row.captured![vi][ai]){const state=getBookConnection(RESEARCH[vi],ASSETS[ai]);const label=state?.phase==='initializing'?'初始化中':state?.phase==='reconnecting'?'重連中':state?.phase==='unsupported'?'不支援':state?.phase==='error'?'取得失敗':'本輪取樣延遲';row.issues.push(ASSETS[ai]+' '+RESEARCH[vi]+'：'+label+(state?.reason?'（'+state.reason+'）':''));}
 if(target%60000===0){row.cadence=60000;emit({type:'row',row,coverage:Object.fromEntries(ASSETS.flatMap((asset,ai)=>{const q=row.quality!.books[0][ai];return q?[[asset,{at:q.capturedAt,bidBps:q.bidBps,askBps:q.askBps,snapshotAt:q.snapshotAt,observedBidBps:q.observedBidBps,observedAskBps:q.observedAskBps,coverageMode:q.coverageMode}]]:[];}))});}
 await Promise.allSettled(ASSETS.map(async asset=>{
  if(!monitored.has(asset))return;
  await Promise.race([Promise.allSettled(perAsset.get(asset)!),waitUntil(target+30000)]);
  const map=sources.get(asset)!;
  const values=EXCHANGES.map(exchange=>map.get(exchange)??emptySource(exchange,'delayed',target,'本輪未取得',now,'—',FIXED_EXCHANGE_QUOTES[exchange]));
  const ranges=Object.fromEntries(DEPTH_OPTIONS.map(depth=>[depthKey(depth),aggregateRange(values,depth)]));
  emit({type:'snapshot',symbol:asset,payload:{symbol:asset,depth:10,sources:values,ranges,...ranges['10'],binancePerp:false,generatedAt:target}});
 }));
}
