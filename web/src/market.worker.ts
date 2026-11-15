/// <reference lib="webworker" />
import {collectCoreRound} from './runtime/core-round';
import {ASSETS,type Asset} from '../shared/model';
import {CONTRACT,emptyRow,type StoredCandle,type StoredRow} from '../shared/contract';
import {nextCoreTarget,sourceInWindow,CORE_SYMBOLS} from '../shared/runtime-policy';
import {researchBook} from '../shared/research-book';
import {ReconnectBackoff} from '../shared/retry';
import {acquire,currentBinanceLimit,depthPayload,startBooks,stopBooks,updateBookDemand,EXCHANGES,RESEARCH_EXCHANGES} from './runtime/books';
import {handleFormalRequest,prepareCoreSources} from './monitor/browser-depth-worker';
import {emptySource} from './monitor/depth-engine/order-book';
import {FIXED_EXCHANGE_QUOTES} from './monitor/market-ranking';
import type {DepthResponse,SourceResult} from './monitor/depth-types';
import {ProfileManager} from './runtime/profiles';
import {UsdmCollector} from './runtime/usdm';
import {IndicatorWarmup} from './indicators/warmup';
import {loadCandlesView} from './storage';
const scope=self as unknown as DedicatedWorkerGlobalScope;
const profiles=new ProfileManager(frame=>scope.postMessage(frame));
const usdm=new UsdmCollector({report:state=>scope.postMessage({type:'book-status',state})});
const indicatorHistory=new IndicatorWarmup(async r=>loadCandlesView(r.asset,r.from,r.to-1,r.interval));
const bootAt=Date.now(),localQa=scope.location.hostname==='localhost'||scope.location.hostname==='127.0.0.1';
let stopped=false,started=false,monitorActive=false,monitorSymbols=new Set<string>();
const sockets=new Set<WebSocket>(),timers=new Set<ReturnType<typeof setTimeout>>(),latest=new Map<string,DepthResponse>();
const pause=(fn:()=>void,ms:number)=>{const t=setTimeout(()=>{timers.delete(t);if(!stopped)fn();},Math.max(0,ms));timers.add(t);return t;};
function watch(ws:WebSocket){let at=Date.now();ws.addEventListener('message',()=>{at=Date.now();});const check=()=>{if(ws.readyState===WebSocket.CLOSED)return;if(Date.now()-at>45000)ws.close();else pause(check,15000);};pause(check,15000);}
async function sample(target:number){await collectCoreRound(target,monitorActive?monitorSymbols:new Set(),acquire,m=>{if(stopped)return;if(m.type==='snapshot'&&(latest.get(m.symbol)?.generatedAt??0)<=m.payload.generatedAt)latest.set(m.symbol,m.payload);scope.postMessage(m);},time=>new Promise(resolve=>pause(resolve,time-Date.now())),Date.now,(exchange,asset,book)=>profiles.rebase(exchange,asset,book));}
function profilePulse(){profiles.pulse();pause(profilePulse,1000-Date.now()%1000);}
function diagnostics(){scope.postMessage({type:'diagnostics',at:Date.now(),bootAt,profiles:profiles.diagnostics(),usdm:usdm.diagnostics(),samples:[...latest].map(([asset,v])=>({asset,at:v.generatedAt,usable:v.sources.filter(s=>s.status==='ok'||s.status==='partial').map(s=>s.exchange)}))});if(localQa)pause(diagnostics,30000);}
function schedule(){const target=nextCoreTarget(Date.now());pause(()=>{void prepareCoreSources(target);},target-10000-Date.now());pause(()=>{void sample(target);schedule();},target-1500-Date.now());}
async function rpc(message:any){
 if(message.type==='indicator-history')return {ok:true,bars:await indicatorHistory.get(message)};
 if(message.type==='indicator-history-cancel'){indicatorHistory.cancel(message.key);return {ok:true};}
 if(message.type!=='aggregate')return handleFormalRequest(message);
 const symbol=String(message.symbol);
 if(!/^[A-Z0-9]{2,15}$/.test(symbol))throw new Error('商品格式無效');
 if(CORE_SYMBOLS.has(symbol)){const payload=latest.get(symbol);if(!payload)throw new Error('等待下一個 30 秒取樣');return {ok:true,result:{payload,nextLimit:5000}};}
 const known=new Set(message.knownExchanges??[]),supported=new Set(message.supportedExchanges??[]);
 const started=Date.now(),results=await Promise.all(EXCHANGES.map(exchange=>known.has(exchange)&&!supported.has(exchange)?Promise.resolve({source:emptySource(exchange,'unsupported',started,'市場目錄確認無此交易對',Date.now,'—',FIXED_EXCHANGE_QUOTES[exchange])}):Promise.race([acquire(exchange,symbol,message.limit),new Promise<{source:SourceResult}>(resolve=>pause(()=>resolve({source:emptySource(exchange,'delayed',started,'本輪等待超過 30 秒',Date.now,'—',FIXED_EXCHANGE_QUOTES[exchange])}),30000))])));const payload=depthPayload(symbol,results.map(r=>r.source));latest.set(symbol,payload);return {ok:true,result:{payload,nextLimit:currentBinanceLimit(symbol)}};
}
function prices(){
 const minutes=new Map<Asset,StoredCandle>(),minuteAt=new Map<Asset,number>();const retry=new ReconnectBackoff();
 let connection=0;const connect=()=>{
  const generation=++connection;
  const streams=ASSETS.map(a=>a.toLowerCase()+'usdt@kline_1m').join('/');
  const ws=new WebSocket('wss://fstream.binance.com/market/stream?streams='+streams);sockets.add(ws);watch(ws);
  ws.onopen=()=>{if(stopped||generation!==connection)return;retry.opened();};
  ws.onmessage=e=>{if(stopped||generation!==connection||ws.readyState!==WebSocket.OPEN)return;try{const x=JSON.parse(e.data).data,asset=x.s?.replace('USDT','') as Asset;if(!ASSETS.includes(asset))return;
   if(x.e==='kline'){const k=x.k;const c:StoredCandle={asset,interval:60000,t:k.t,o:+k.o,h:+k.h,l:+k.l,c:+k.c,v:+k.v,closed:k.x,complete:true,source:'binance-usdm',observedAt:Date.now()};minutes.set(asset,c);minuteAt.set(asset,Date.now());if(c.closed)scope.postMessage({type:'candle',candle:c,at:Date.now()});}
  }catch{}};
  ws.onerror=()=>ws.close();ws.onclose=()=>{sockets.delete(ws);if(stopped||generation!==connection)return;pause(connect,retry.delay());};
 };
 const published=new Map<string,number>();const publish=()=>{for(const b of minutes.values()){const at=minuteAt.get(b.asset)??0,key=b.asset+':'+b.interval;if(at>(published.get(key)??0)){scope.postMessage({type:'candle',candle:{...b},at});published.set(key,at);}}pause(publish,1000);};connect();publish();
}

scope.onmessage=e=>{
 const m=e.data;
 if(m==='start'&&!started){started=true;startBooks(state=>{if(!stopped)scope.postMessage({type:'book-status',state});});usdm.start();schedule();prices();profilePulse();if(localQa)pause(diagnostics,30000);}
 else if(m==='stop'){stopped=true;indicatorHistory.stop();profiles.stop();usdm.stop();stopBooks();for(const s of sockets)s.close();for(const t of timers)clearTimeout(t);scope.close();}
 else if(m.type==='diagnostics')diagnostics();
 else if(m.type==='profile-demand')profiles.setDemands(m.demands??[]);
 else if(m.type==='monitor-demand'){monitorActive=m.active;monitorSymbols=new Set(m.symbols);updateBookDemand(monitorActive?monitorSymbols:new Set());}
 else if(m.type==='rpc')void rpc(m.message).then(result=>scope.postMessage({type:'rpc-result',requestId:m.requestId,result}),error=>scope.postMessage({type:'rpc-result',requestId:m.requestId,result:{ok:false,error:error instanceof Error?error.message:'行情取得失敗'}}));
};
