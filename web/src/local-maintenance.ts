import {marketRuntime} from './runtime/client';
import * as storage from './storage';
import {cleanupPlan,LOCAL_LIMIT,LOCAL_TARGET} from '../shared/managed-storage';
import {retireLocalDatabases,retireTemporaryBackups} from './feature-retirement';
import {STORAGE_MAINTENANCE_LOCK} from '../shared/local-history-export';
type State={bytes:number;protectedBytes:number;ready:boolean;error:string};
let state:State={bytes:0,protectedBytes:0,ready:false,error:''},started=false,running=false,nextAt=0,initialized=false,localHours=24;
const views=new Map<string,{hours:number;at:number}>(),channel=marketRuntime.researchChannel();
function advertise(){channel?.postMessage({type:'storage-view',owner:marketRuntime.state().owner,hours:localHours,active:!document.hidden&&location.pathname==='/'});}
channel?.addEventListener('message',e=>{const p=e.data;if(p?.type!=='storage-view')return;if(p.active===false){views.delete(p.owner);return;}if(typeof p.owner==='string'&&Number.isInteger(p.hours)&&p.hours>0&&p.hours<=4320)views.set(p.owner,{hours:p.hours,at:Date.now()});});
function requestedHours(){for(const [id,v]of views)if(Date.now()-v.at>90000)views.delete(id);return Math.max(!document.hidden&&location.pathname==='/'?localHours:0,...[...views.values()].map(v=>v.hours));}
function protectedEntries(records:Awaited<ReturnType<typeof storage.managedBlocks>>){const hours=requestedHours(),from=Date.now()-hours*3600000;return records.map(r=>({...r,pinned:r.pinned||hours>0&&r.at+900000>from}));}
const listeners=new Set<()=>void>();
function notify(next:State){state=next;for(const f of listeners)f();const stamp=marketRuntime.collectorStamp();if(marketRuntime.isCollector(stamp))marketRuntime.publish({type:'storage-maintenance',owner:stamp!.id,epoch:stamp!.epoch,state});}
async function run(){if(running||Date.now()<nextAt||!marketRuntime.isLeader())return;running=true;nextAt=Date.now()+30000;const stamp=marketRuntime.collectorStamp(),current=()=>marketRuntime.isCollector(stamp);
 try{await navigator.locks.request(STORAGE_MAINTENANCE_LOCK,async()=>{
  if(!current())return;if(!initialized){await storage.initStorage();initialized=true;}
  if(!await storage.getMeta('retiredFeaturesV1')){await storage.retireProtection(current);if(!current())return;await retireLocalDatabases();await retireTemporaryBackups();if(!current())return;await storage.setMeta('retiredFeaturesV1',true);}
  const plan=cleanupPlan(protectedEntries(await storage.managedBlocks()),await storage.managedMetadataBytes());let removed=0;
  if(plan.total>LOCAL_LIMIT){await storage.refreshRecoverability(current);const versions=protectedEntries(await storage.managedBlocks()),actual=cleanupPlan(versions,await storage.managedMetadataBytes()),byId=new Map(versions.map(v=>[v.id,v]));for(const id of actual.ids){if(!current())return;const v=byId.get(id)!;if(protectedEntries([v])[0].pinned)continue;if(await storage.removeManagedBlock(id.slice(8),v.revision))removed+=v.bytes;}await storage.setMeta('cleanup',{at:Date.now(),removed});}
  if(!current())return;const latest=cleanupPlan(protectedEntries(await storage.managedBlocks()),await storage.managedMetadataBytes());if(removed||latest.total<LOCAL_TARGET)await storage.setMeta('quotaBlocked',false);notify({bytes:latest.total,protectedBytes:latest.protectedBytes,ready:true,error:latest.remaining>LOCAL_LIMIT?'受保護資料超過容量上限，已保留，暫停可重建回補。':''});if(latest.remaining>LOCAL_LIMIT)await storage.setMeta('quotaBlocked',true);
 });}catch(e){if(current())notify({...state,error:e instanceof Error?e.message:'本機容量檢查失敗，資料保留。'});}finally{running=false;}}
export const localMaintenance={requestedHours,setView(hours:number){localHours=hours;advertise();},snapshot:()=>state,subscribe(f:()=>void){listeners.add(f);return()=>listeners.delete(f);},start(){if(started)return;started=true;marketRuntime.events(m=>{if(m.type==='storage-maintenance'&&!marketRuntime.isLeader()){const stamp=marketRuntime.collectorStamp();if(stamp&&m.owner===stamp.id&&m.epoch===stamp.epoch)notify(m.state);}});marketRuntime.subscribe(()=>{advertise();void run();});document.addEventListener('visibilitychange',advertise);setInterval(()=>{advertise();void run();},30000);advertise();void run();}};
