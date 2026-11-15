import {preferredOwner,monitorPresence,type Presence} from '../../shared/runtime-policy';
import * as storage from '../storage';
import type {DepthResponse} from '../monitor/depth-types';
import {PROFILE_VERSION,validProfileDemand,type ProfileDemand} from '../../shared/order-book-profile';
import {canvasDiagnostics} from '../profile/ProfilePrimitive';
import {MARKET_HISTORY_VERSION} from '../../shared/market-history';
import {INDICATOR_VERSION} from '../../shared/technical-indicators';
import {STRATEGY_VERSION} from '../../shared/strategy-v37';
const qaSamples:unknown[]=[];

type RuntimeMessage={type:string;[key:string]:any};
type ResearchSubscription={onmessage:((e:MessageEvent<any>)=>void)|null;onerror:((e:ErrorEvent)=>void)|null;postMessage:(value:unknown)=>void;terminate:()=>void};
const LOCK='marketdepth-unified-collector-v1',CHANNEL='marketdepth-unified-v1';
const id=crypto.randomUUID(),peers=new Map<string,Presence>(),listeners=new Set<()=>void>(),events=new Set<(m:RuntimeMessage)=>void>();
const snapshots=new Map<string,DepthResponse>(),research=new Set<ResearchSubscription>();
const bookStates=new Map<string,RuntimeMessage>();
const demands=new Map<string,string[]>();
const profileDemands=new Map<string,ProfileDemand[]>(),localProfiles=new Map<string,ProfileDemand>();
let profileOwner:{id:string;epoch:number}|null=null,profileCapable:boolean|null=null,historyCapable:boolean|null=null,indicatorCapable:boolean|null=null,highestTerm=0,ownerAt=0;
let strategyCapable:boolean|null=null;
function profileCapability(capable:boolean|null,owner:{id:string;epoch:number}|null){const changed=profileCapable!==capable||profileOwner?.id!==owner?.id||profileOwner?.epoch!==owner?.epoch;profileCapable=capable;profileOwner=owner;if(owner){highestTerm=Math.max(highestTerm,owner.epoch);ownerAt=Date.now();}if(changed)consume({type:'profile-capability',capable,owner:owner?.id,epoch:owner?.epoch});}
function accepted(m:RuntimeMessage){return !!profileOwner&&m.owner===profileOwner.id&&m.epoch===profileOwner.epoch;}
function bootstrap(){return {type:'bootstrap',owner:id,epoch,profileEpoch:epoch,snapshots:[...snapshots],row:latestRow,bookStates:[...bookStates.values()],profileVersion:PROFILE_VERSION,historyVersion:MARKET_HISTORY_VERSION,indicatorVersion:INDICATOR_VERSION,strategyVersion:STRATEGY_VERSION,presence:presence()};}
function syncProfiles(){const list=[...peers.values()].filter(p=>p.visible&&!p.monitor).flatMap(p=>profileDemands.get(p.id)??[]);worker?.postMessage({type:'profile-demand',demands:list});}
function sendProfiles(){profileDemands.set(id,[...localProfiles.values()]);broadcast({type:'profile-demand',demands:[...localProfiles.values()]});syncProfiles();}
let active=false,suspended=false,leader=false,worker:Worker|null=null,channel:BroadcastChannel|null=null,timer:ReturnType<typeof setInterval>|undefined;
let release:(()=>void)|undefined,claiming=false,route=location.pathname,epoch=0,sequence=0,monitorSymbols:string[]=[];
const pending=new Map<string,{resolve:(m:any)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
let latestRow:RuntimeMessage|undefined,saveTimer:ReturnType<typeof setTimeout>|undefined;
function notify(){for(const cb of listeners)cb();}
function presence(){return {id,visible:!document.hidden,monitor:route==='/monitor',at:Date.now()};}
function state(){return {leader,...monitorPresence([...peers.values()]),owner:id};}
function broadcast(m:RuntimeMessage){channel?.postMessage({...m,sender:id});}
function syncDemand(){const symbols=[...new Set([...peers.values()].filter(p=>p.monitor).flatMap(p=>demands.get(p.id)??[]))];worker?.postMessage({type:'monitor-demand',symbols,active:state().active});syncProfiles();}
function remember(){clearTimeout(saveTimer);saveTimer=setTimeout(()=>{if(leader)void storage.setMeta('unified-snapshots',[...snapshots]).catch(()=>{});},1000);}
function consume(m:RuntimeMessage){
 if(m.type==='diagnostics'&&(location.hostname==='localhost'||location.hostname==='127.0.0.1')){let output=document.getElementById('marketdepth-qa') as HTMLOutputElement|null;if(!output){output=document.createElement('output');output.id='marketdepth-qa';output.hidden=true;document.body.appendChild(output);}qaSamples.push({...m,canvas:canvasDiagnostics(),heap:(performance as Performance&{memory?:{usedJSHeapSize:number}}).memory?.usedJSHeapSize});if(qaSamples.length>64)qaSamples.shift();output.value=JSON.stringify(qaSamples);}
 if(m.type==='book-status')bookStates.set((m.state.market??'spot')+':'+m.state.exchange+':'+m.state.symbol,m);
 if(m.type==='snapshot'){if((snapshots.get(m.symbol)?.generatedAt??0)>m.payload.generatedAt)return;snapshots.set(m.symbol,m.payload);if(leader)remember();}
 if(m.type==='row'){if(m.row?.cadence!==60000)return;if(latestRow&&latestRow.row?.t>m.row?.t)return;latestRow=m;}
 if(m.type==='row'||m.type==='candle'||m.type==='auth-required'||m.type==='book-status')for(const r of research)r.onmessage?.({data:m} as MessageEvent);
 for(const cb of events)cb(m);
}
function stopWorker(){
 leader=false;epoch++;historyCapable=null;indicatorCapable=null;strategyCapable=null;profileCapability(null,null);worker?.postMessage('stop');worker?.terminate();worker=null;
 for(const [key,p]of pending){clearTimeout(p.timer);p.reject(new Error('行情主控交接中'));pending.delete(key);}
 release?.();release=undefined;notify();
}
async function startWorker(){
 if(!active||suspended||leader)return;leader=true;const attempt=++epoch;
 const previous=await storage.getMeta<number>('collector-term').catch(()=>0);if(!active||suspended||!leader||attempt!==epoch)return;
 const generation=epoch=Math.max(Date.now(),(previous??0)+1,highestTerm+1);await storage.setMeta('collector-term',generation);if(!active||suspended||!leader||generation!==epoch)return;
 worker=new Worker(new URL('../market.worker.ts',import.meta.url),{type:'module'});
 worker.onmessage=async e=>{
  if(!active||!leader||generation!==epoch)return;
  if(!navigator.locks&&!await storage.lease(id,Date.now())){stopWorker();return;}
  if(!active||!leader||generation!==epoch)return;
  const m=e.data as RuntimeMessage;
  if(m.type==='profile-frame'){consume({...m,owner:id,epoch:generation});broadcast({type:'profile-data',payload:{...m,owner:id,epoch:generation}});return;}
  if(m.type==='rpc-result'){const p=pending.get(m.requestId);if(p){clearTimeout(p.timer);pending.delete(m.requestId);p.resolve(m.result);}return;}
  const data={...m,owner:id,epoch:generation};consume(data);broadcast({type:'data',payload:data});
 };
 worker.onerror=e=>{if(!leader||generation!==epoch)return;for(const r of research)r.onerror?.(e);worker?.terminate();worker=null;leader=false;void startWorker().catch(()=>stopWorker());};
 historyCapable=true;indicatorCapable=true;strategyCapable=true;profileCapability(true,{id,epoch:generation});worker.postMessage('start');syncDemand();notify();
 broadcast(bootstrap());
}
async function elect(){
 if(!active||suspended)return;
 const preferred=preferredOwner([...peers.values()]);
 if(leader||preferred!==id||claiming)return;claiming=true;
 try{
  if(navigator.locks)await navigator.locks.request(LOCK,{ifAvailable:true},async lock=>{
   if(!lock||!active||preferredOwner([...peers.values()])!==id)return;
   await new Promise<void>(resolve=>{release=resolve;void startWorker().catch(()=>stopWorker());});
  });
  else if(await storage.lease(id,Date.now()))await startWorker();
 }finally{claiming=false;}
}
function pulse(){
 if(!active||suspended)return;const p=presence();peers.set(id,p);
 for(const [key,value]of peers)if(key!==id&&Date.now()-value.at>(value.visible?20000:180000)){peers.delete(key);demands.delete(key);profileDemands.delete(key);}
 demands.set(id,monitorSymbols);profileDemands.set(id,[...localProfiles.values()]);broadcast({type:'presence',presence:p,symbols:monitorSymbols,profiles:[...localProfiles.values()]});notify();
 if(!leader&&(!profileOwner||Date.now()-ownerAt>6000))broadcast({type:'hello'});
 if(leader){broadcast({type:'leader-status',owner:id,epoch,profileVersion:PROFILE_VERSION});syncDemand();if(!navigator.locks)void storage.lease(id,Date.now()).then(won=>{if(!won)stopWorker();});}
 void elect();
}
function receive(m:RuntimeMessage){
 if(m.sender===id)return;
 if(m.type==='presence'){peers.set(m.presence.id,{...m.presence,at:Date.now()});demands.set(m.presence.id,m.symbols??[]);if(m.profiles)profileDemands.set(m.sender,m.profiles.filter(validProfileDemand));if(leader)syncDemand();notify();void elect();}
 else if(m.type==='goodbye'){peers.delete(m.sender);demands.delete(m.sender);profileDemands.delete(m.sender);if(profileOwner?.id===m.sender)profileCapability(null,null);if(leader)syncDemand();notify();void elect();}
 else if(m.type==='profile-demand'){profileDemands.set(m.sender,(m.demands??[]).filter(validProfileDemand));if(leader)syncProfiles();}
 else if(m.type==='profile-data'||m.type==='data'){if(profileCapable===true&&accepted(m.payload)&&m.sender===profileOwner?.id){ownerAt=Date.now();consume(m.payload);}}
 else if(m.type==='hello'&&leader)broadcast(bootstrap());
 else if(m.type==='leader-status'){if(accepted(m)&&m.sender===profileOwner?.id)ownerAt=Date.now();else broadcast({type:'hello'});}
 else if(m.type==='bootstrap'){
  if(m.presence?.id===m.sender)peers.set(m.sender,{...m.presence,at:Date.now()});
  const term=m.epoch??m.profileEpoch;
  if(!Number.isSafeInteger(term)){if(!leader&&(profileOwner?.id===m.sender||!profileOwner&&!highestTerm))profileCapability(false,profileOwner??{id:m.sender,epoch:0});return;}
  if(leader||term<highestTerm||term===highestTerm&&profileOwner&&profileOwner.id!==m.sender)return;
  historyCapable=m.historyVersion===MARKET_HISTORY_VERSION;
  indicatorCapable=m.indicatorVersion===INDICATOR_VERSION;
  strategyCapable=m.strategyVersion===STRATEGY_VERSION;
  profileCapability(m.profileVersion===PROFILE_VERSION,{id:m.sender,epoch:term});
  if(m.profileVersion!==PROFILE_VERSION)return;
  for(const [symbol,payload]of m.snapshots??[])consume({type:'snapshot',symbol,payload,replay:true,owner:m.sender,epoch:term});for(const state of m.bookStates??[])consume({...state,replay:true,owner:m.sender,epoch:term});if(m.row)consume({...m.row,replay:true,owner:m.sender,epoch:term});
 }
 else if(m.type==='request'&&leader){const term=epoch;void requestMarket(m.message,m.timeout).then(result=>{if(leader&&epoch===term)broadcast({type:'reply',owner:id,epoch:term,requestId:m.requestId,result});},e=>{if(leader&&epoch===term)broadcast({type:'reply',owner:id,epoch:term,requestId:m.requestId,error:String(e)});});}
 else if(m.type==='reply'){if(!accepted(m))return;const p=pending.get(m.requestId);if(p){clearTimeout(p.timer);pending.delete(m.requestId);m.error?p.reject(new Error(m.error)):p.resolve(m.result);}}
 else if(['row','snapshot','candle','book-status','profile-frame','rpc-result','storage-maintenance','market-history-state','strategy-update'].includes(m.type)){if(accepted(m)&&m.sender===profileOwner?.id)consume(m);}
 else if(m.type==='research-coordination'){if(!['prices','coverage','job-state'].includes(m.payload?.type)||accepted(m)&&m.sender===profileOwner?.id)consume(m);}
 else consume(m);
}
const visibility=()=>pulse();
const resume=()=>{suspended=false;pulse();};
const freeze=()=>{suspended=true;stopWorker();peers.delete(id);broadcast({type:'goodbye'});void storage.releaseLease(id).catch(()=>{});};
export const marketRuntime={
 start(){
  if(active)return;active=true;suspended=false;
  channel=typeof BroadcastChannel==='undefined'?null:new BroadcastChannel(CHANNEL);
  channel?.addEventListener('message',e=>receive(e.data));
  document.addEventListener('visibilitychange',visibility);document.addEventListener('freeze',freeze);document.addEventListener('resume',resume);window.addEventListener('pagehide',freeze);window.addEventListener('pageshow',resume);
  void storage.getMeta<[string,DepthResponse][]>('unified-snapshots').then(saved=>{if(!active)return;for(const [symbol,payload]of saved??[])if(!snapshots.has(symbol))consume({type:'snapshot',symbol,payload,replay:true});}).catch(()=>{});
  pulse();broadcast({type:'hello'});timer=setInterval(pulse,2000);
 },
 stop(){active=false;clearInterval(timer);clearTimeout(saveTimer);stopWorker();broadcast({type:'goodbye'});channel?.close();channel=null;peers.clear();demands.clear();void storage.releaseLease(id).catch(()=>{});document.removeEventListener('visibilitychange',visibility);document.removeEventListener('freeze',freeze);document.removeEventListener('resume',resume);window.removeEventListener('pagehide',freeze);window.removeEventListener('pageshow',resume);},
 setRoute(next:string){route=next;pulse();},
 setMonitorSymbols(symbols:string[]){if(JSON.stringify(monitorSymbols)===JSON.stringify(symbols))return;monitorSymbols=symbols;pulse();},
 state,isLeader:()=>leader,
 collectorStamp:()=>profileOwner?{...profileOwner}:null,
 isCollector:(stamp:{id:string;epoch:number}|null)=>!!stamp&&leader&&stamp.id===id&&stamp.epoch===epoch,
 subscribe(cb:()=>void){listeners.add(cb);return()=>{listeners.delete(cb);};},
 events(cb:(m:RuntimeMessage)=>void){events.add(cb);return()=>{events.delete(cb);};},
 profileCapability:()=>profileCapable,
 historyCapability:()=>historyCapable,
 indicatorCapability:()=>indicatorCapable,
 strategyCapability:()=>strategyCapable,
 profileDemand(key:string,demand:Omit<ProfileDemand,'id'>|null){const fullId=id+':'+key;if(demand)localProfiles.set(fullId,{...demand,id:fullId});else localProfiles.delete(fullId);sendProfiles();return fullId;},
 publish(m:RuntimeMessage){consume(m);broadcast(m);},
 snapshot:(symbol:string)=>snapshots.get(symbol),
 research():ResearchSubscription{const r:ResearchSubscription={onmessage:null,onerror:null,postMessage(){if(latestRow)queueMicrotask(()=>r.onmessage?.({data:latestRow} as MessageEvent));for(const state of bookStates.values())queueMicrotask(()=>r.onmessage?.({data:state} as MessageEvent));},terminate(){research.delete(r);}};research.add(r);return r;},
 researchChannel(){const cleanups:(()=>void)[]=[];return {postMessage:(payload:any)=>{const fenced=['prices','coverage','job-state'].includes(payload?.type);if(fenced&&!leader)return;marketRuntime.publish({type:'research-coordination',payload,...(fenced?{owner:id,epoch}:{})});},addEventListener(_type:string,cb:(e:MessageEvent)=>void){cleanups.push(marketRuntime.events(m=>{if(m.type==='research-coordination')cb({data:m.payload} as MessageEvent);}));},close(){for(const cleanup of cleanups)cleanup();}};},
};
export function requestMarket(message:Record<string,unknown>,timeoutMs=45000,signal?:AbortSignal):Promise<any>{
 if(signal?.aborted)return Promise.reject(new DOMException('aborted','AbortError'));
 const requestId=id+':'+(++sequence);
 return new Promise((resolve,reject)=>{
  const abort=()=>{clearTimeout(pending.get(requestId)?.timer);pending.delete(requestId);reject(new DOMException('aborted','AbortError'));};
  const finish=(fn:(v:any)=>void)=>(v:any)=>{signal?.removeEventListener('abort',abort);fn(v);};
  const clock=setTimeout(()=>{pending.delete(requestId);finish(reject)(new Error('行情請求逾時'));},timeoutMs);
  pending.set(requestId,{resolve:finish(resolve),reject:finish(reject),timer:clock});signal?.addEventListener('abort',abort,{once:true});
  if(leader&&worker)worker.postMessage({type:'rpc',requestId,message});
  else broadcast({type:'request',requestId,message,timeout:timeoutMs});
 });
}
