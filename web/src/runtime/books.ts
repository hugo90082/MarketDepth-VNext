import {loadBrowserSource,prioritizeSource,setBinanceRecovery,stopBinanceStreams,stopPreparedSources,isBinanceStreamReady} from '../monitor/browser-depth-worker';
import {getSelectedMarket} from '../monitor/market-selection-client';
import {createRawBook,summarizeBook,emptySource,aggregateRange,type RawBook} from '../monitor/depth-engine/order-book';
import {bookForSource} from '../monitor/depth-engine/source-runtime';
import {DEPTH_OPTIONS,depthKey,type SourceResult,type DepthResponse} from '../monitor/depth-types';
import {CoinbaseLiveBook} from '../../shared/live-books';
import {ReconnectBackoff} from '../../shared/retry';
import {FIXED_EXCHANGE_QUOTES} from '../monitor/market-ranking';
import {withAbortDeadline} from '../monitor/request-deadline';
import {bookKey,registerProfileBook,emitProfileBook,profileBookInterested} from '../../shared/profile-books';

export const EXCHANGES=['Binance','OKX','Bybit','Coinbase','Bitfinex','Kraken'] as const;
export const RESEARCH_EXCHANGES=['Binance','Coinbase','Kraken','Bitfinex'] as const;
type Acquired={source:SourceResult;book?:RawBook};
const inflight=new Map<string,Promise<Acquired>>(),limits=new Map<string,number>();
const unsupported=new Map<string,number>();
const coinbase=new Map<string,CoinbaseLiveBook>();
const products=new Map<string,string>(),quarantined=new Set<string>(),retryTimers=new Map<string,ReturnType<typeof setTimeout>>(),retries=new Map<string,ReconnectBackoff>();
export type BookConnection={exchange:string;symbol:string;phase:'initializing'|'reconnecting'|'ready'|'late'|'error'|'unsupported';reason?:string;at:number};
let report:(state:BookConnection)=>void=()=>{};
const connections=new Map<string,BookConnection>(),warming=new Set<string>();
export function getBookConnection(exchange:string,symbol:string){return connections.get(exchange+':'+symbol);}
function state(exchange:string,symbol:string,phase:BookConnection['phase'],reason?:string){if(stopped)return;const value={exchange,symbol,phase,reason,at:Date.now()};const previous=getBookConnection(exchange,symbol);connections.set(exchange+':'+symbol,value);if(previous?.phase!==phase||previous.reason!==reason)report(value);}
let socket:WebSocket|null=null,stopped=false,reconnect:ReturnType<typeof setTimeout>|undefined;
const backoff=new ReconnectBackoff();
function connectCoinbase(){
 if(stopped||!coinbase.size||socket&&socket.readyState<WebSocket.CLOSING)return;
 const origin=typeof location==='undefined'?'http://localhost':location.origin,url=new URL('/api/coinbase-stream',origin);url.protocol=url.protocol==='https:'?'wss:':'ws:';
 const ws=socket=new WebSocket(url.toString());
 let activity=Date.now(),closeReason='';
 const watchdog=setInterval(()=>{if(Date.now()-activity>45000)ws.close();},15000);
 ws.onopen=()=>{if(socket!==ws||stopped||ws.readyState!==WebSocket.OPEN)return;backoff.opened();ws.send(JSON.stringify({type:'subscribe',product_ids:[...products.values()],channels:['level2_batch','heartbeat']}));};
 ws.onmessage=e=>{if(socket!==ws||stopped||ws.readyState!==WebSocket.OPEN)return;activity=Date.now();try{const data=JSON.parse(e.data);if(data.type==='error'){
  const rejected=[...products].filter(([symbol,product])=>!['BTC','ETH','SOL'].includes(symbol)&&(data.product_id===product||String(data.message??'').includes(product)||!data.product_id));
  for(const [symbol,product]of rejected){quarantined.add(symbol);coinbase.delete(symbol);products.delete(symbol);state('Coinbase',symbol,'error',data.message||'商品訂閱失敗');ws.send(JSON.stringify({type:'unsubscribe',product_ids:[product],channels:['level2_batch','heartbeat']}));}
  if(!rejected.length)ws.close();return;
 }const symbol=[...products].find(([,p])=>p===data.product_id)?.[0],book=symbol?coinbase.get(symbol):undefined;if(!book)return;if(data.type==='heartbeat')book.heartbeat(activity);else if(data.type==='snapshot'||data.type==='l2update'){book.update(data,activity);state('Coinbase',symbol!,'ready','Sites 串流中繼');}}catch{for(const [symbol,book]of coinbase){book.ready=false;emitProfileBook({key:bookKey('coinbase',symbol),type:'status'});}ws.close();}};
 ws.onerror=()=>{closeReason='Sites 串流中繼連線失敗';ws.close();};ws.onclose=e=>{clearInterval(watchdog);if(socket!==ws)return;socket=null;for(const [symbol,book] of coinbase){book.ready=false;emitProfileBook({key:bookKey('coinbase',symbol),type:'status'});state('Coinbase',symbol,'reconnecting',closeReason||`Sites 串流中繼已關閉${e?.code?`（${e.code}）`:''}${e?.reason?`：${e.reason}`:''}`);}if(!stopped)reconnect=setTimeout(connectCoinbase,backoff.delay());};
}
async function ensureCoinbase(symbol:string){
 if(quarantined.has(symbol))return;
 if(!coinbase.has(symbol)){const market=await getSelectedMarket('Coinbase',symbol);if(stopped||!market)return;if(!coinbase.has(symbol)){const key=bookKey('coinbase',symbol),book=new CoinbaseLiveBook((type,patches)=>emitProfileBook({key,type,patches}),()=>profileBookInterested(key));coinbase.set(symbol,book);products.set(symbol,market.pair);registerProfileBook(key,()=>({...book.view(),ready:book.ready&&!stopped&&coinbase.get(symbol)===book,tick:market.tickSize,complete:true}));if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify({type:'subscribe',product_ids:[market.pair],channels:['level2_batch','heartbeat']}));}}
 connectCoinbase();return coinbase.get(symbol)!;
}
function warmBinance(symbol:string,reason?:string){
 if(stopped||warming.has(symbol))return;warming.add(symbol);clearTimeout(retryTimers.get(symbol));state('Binance',symbol,reason?'reconnecting':'initializing',reason);
 void acquire('Binance',symbol).then(result=>{if(stopped)return;if(isBinanceStreamReady(symbol)){retries.get(symbol)?.opened();state('Binance',symbol,'ready');return;}const retry=retries.get(symbol)??new ReconnectBackoff();retries.set(symbol,retry);state('Binance',symbol,'reconnecting',result.source.error||'串流尚未就緒');retryTimers.set(symbol,setTimeout(()=>warmBinance(symbol,'等待重連'),retry.delay()));}).finally(()=>warming.delete(symbol));
}
export function startBooks(onState:(value:BookConnection)=>void=()=>{}){stopped=false;report=onState;setBinanceRecovery((pair:string,reason:string)=>{const symbol=pair.replace(/USDT$/,'');if(['BTC','ETH','SOL'].includes(symbol))warmBinance(symbol,reason);});for(const symbol of ['BTC','ETH','SOL']){void ensureCoinbase(symbol).catch(e=>state('Coinbase',symbol,'error',String(e)));warmBinance(symbol);}}
export function updateBookDemand(symbols:ReadonlySet<string>){const wanted=new Set(['BTC','ETH','SOL',...symbols]);for(const symbol of coinbase.keys())if(!wanted.has(symbol)){if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify({type:'unsubscribe',product_ids:[products.get(symbol)],channels:['level2_batch','heartbeat']}));coinbase.delete(symbol);products.delete(symbol);}}
export function stopBooks(){stopped=true;clearTimeout(reconnect);for(const timer of retryTimers.values())clearTimeout(timer);retryTimers.clear();stopBinanceStreams();stopPreparedSources();socket?.close();}
export function depthPayload(symbol:string,sources:SourceResult[],target?:number):DepthResponse{
 const ranges=Object.fromEntries(DEPTH_OPTIONS.map(depth=>[depthKey(depth),aggregateRange(sources,depth)]));
 return {symbol,depth:10,sources,ranges,...ranges['10'],binancePerp:false,generatedAt:target??Date.now()};
}
export function currentBinanceLimit(symbol:string){return limits.get(symbol)??(['BTC','ETH','SOL'].includes(symbol)?5000:1000);}
export function acquire(exchange:typeof EXCHANGES[number],symbol:string,initialLimit?:number):Promise<Acquired>{
 const key=exchange+':'+symbol,existing=inflight.get(key);if(existing)return existing;
 if((unsupported.get(key)??0)>Date.now())return Promise.resolve({source:emptySource(exchange,'unsupported',Date.now(),'交易對不存在',Date.now,'—',FIXED_EXCHANGE_QUOTES[exchange])});
 const task=(async()=>{
  const started=Date.now();let failure:SourceResult|undefined;
  try{
   const market=await getSelectedMarket(exchange,symbol);
   if(!market){state(exchange,symbol,'unsupported');return {source:emptySource(exchange,'unsupported',started,'沒有可用的美元現貨交易對',Date.now,'—',FIXED_EXCHANGE_QUOTES[exchange])};}
   if(exchange==='Coinbase'){
    const live=await ensureCoinbase(symbol),raw=live?.rawBook(Date.now());
    if(raw){const book=createRawBook({...raw,pair:market.pair,quote:'USD',feed:'Coinbase level2_batch + heartbeat · Sites 串流中繼',capturedAt:Date.now(),lastMessageAt:live!.at,tickSize:market.tickSize,acquisitionMode:'web-feed'});return {book,source:summarizeBook(exchange,book,started)};}
   }
   // Reserve time for the existing Sites fallback inside the same 30-second round.
   const remainingDirect=(exchange==='Binance'?30000:18000)-(Date.now()-started);if(remainingDirect<=0)throw new Error('直連準備逾時');
   const next=await withAbortDeadline(async signal=>{if(['BTC','ETH','SOL'].includes(symbol))prioritizeSource(signal);return loadBrowserSource(exchange,symbol,limits.get(symbol)??initialLimit??currentBinanceLimit(symbol),signal);},remainingDirect,`${exchange} 直連逾時`) as {source:SourceResult&{rawBook?:RawBook};nextLimit:number};
   if(exchange==='Binance')limits.set(symbol,next.nextLimit);
   const {rawBook,...source}=next.source;
   if(rawBook){state(exchange,symbol,'ready');return {book:rawBook,source};}
   if(source.status==='unsupported'){unsupported.set(key,Date.now()+6*60*60*1000);state(exchange,symbol,'unsupported',source.error);return {source};}failure=source;
  }catch(error){const detail=error as {status?:number;upstreamHttp?:boolean};if(!detail?.upstreamHttp&&(detail?.status===400||detail?.status===404)){unsupported.set(key,Date.now()+6*60*60*1000);state(exchange,symbol,'unsupported');return {source:emptySource(exchange,'unsupported',started,'交易對不存在',Date.now,'—',FIXED_EXCHANGE_QUOTES[exchange])};}failure=emptySource(exchange,'error',started,error instanceof Error?error.message:'來源未取得',Date.now,'—',FIXED_EXCHANGE_QUOTES[exchange]);}
  try{
   const remaining=30000-(Date.now()-started);if(remaining<=0)throw new Error('本輪取樣逾時');
   const raw=await withAbortDeadline(signal=>bookForSource(exchange,symbol,signal),Math.min(12000,remaining),'Sites 備援逾時');
   if(!Number.isSafeInteger(raw.capturedAt)||raw.quote!==FIXED_EXCHANGE_QUOTES[exchange]||!Array.isArray(raw.bids)||!Array.isArray(raw.asks)||raw.bids.length+raw.asks.length>1000000||![...raw.bids,...raw.asks].every(v=>v.length===2&&v.every(Number.isFinite)&&v[0]>0&&v[1]>=0))throw new Error('備援格式錯誤');
   const book=createRawBook({...raw,acquisitionMode:'cloud-fallback',fallbackReason:failure?.error});state(exchange,symbol,'ready');return {book,source:summarizeBook(exchange,book,started)};
  }catch(error){const reason=[failure?.error,error instanceof Error?error.message:'Sites 備援未取得'].filter(Boolean).join('；');state(exchange,symbol,'error',reason);return {source:{...failure!,error:reason}};}
 })().finally(()=>inflight.delete(key));
 inflight.set(key,task);return task;
}
