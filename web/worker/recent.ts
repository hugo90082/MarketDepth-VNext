import {RailwayAuthRequired} from './auth';
import { CONTRACT, isContract } from '../shared/contract';
import { mergeRows, validateRows, type Connection, type SpotRow } from '../shared/model';
import { claim, initialize, owns, readSnapshot, release, saveSnapshot, UPSTREAM_GAP_MS, type Env } from './db';
import { digest, UpstreamError, pending } from './core';
import { checkResponse } from './history';
import {sourceCadence,upstreamRows} from './upstream-format';

const BASE='https://marketdepth-production.up.railway.app';
const BUFFER_MS=16*60_000;
type RecentState={
 secretHash:string;unauthorized:boolean;retryAt:number;updatedAt:number;pollMinMs:number;
 rows:SpotRow[];connection:Connection;dataAgeMs:number|null;latestTargetTsMs:number|null;
};
const initial=(secretHash:string):RecentState=>({secretHash,unauthorized:false,retryAt:0,updatedAt:0,pollMinMs:0,rows:[],connection:pending(),dataAgeMs:null,latestTargetTsMs:null});
const age=(s:RecentState,now:number)=>s.dataAgeMs===null?null:s.dataAgeMs+Math.max(0,now-s.updatedAt);

/**
 * Fetch Recent only when a browser explicitly reports an incomplete live row.
 * D1 shares a short application cache and the same global Railway gate as
 * Historical. A known target is served without another upstream request.
 */
export async function recentGapView(env:Env,fetcher:typeof fetch=fetch,clock=()=>Date.now(),target?:number,authorize:()=>Promise<void>=async()=>{}){
 await initialize(env.DB);const now=clock();
 if(!env.HISTORY_READ_TOKEN)return {ok:false as const,error:{code:'STORAGE_UNAVAILABLE'}};
 const secretHash=await digest(new TextEncoder().encode(env.HISTORY_READ_TOKEN));
 let state=await readSnapshot<RecentState>(env.DB,'v3-recent')??initial(secretHash);
 if(state.secretHash!==secretHash)state=initial(secretHash);
 const cached=()=>target!==undefined&&state.rows.some(row=>row.t===target);
 const fresh=()=>state.connection.state==='ok'&&state.updatedAt>0&&now-state.updatedAt<Math.max(2000,state.pollMinMs||0);
 const owner=crypto.randomUUID();
 if(!cached()&&!fresh()&&!state.unauthorized&&state.retryAt<=now&&await claim(env.DB,'collector',now,owner,15_000,UPSTREAM_GAP_MS)){
  let next=now;
  try{
   // Another visitor may have filled this target before our D1 claim.
   const persisted=await readSnapshot<RecentState>(env.DB,'v3-recent');
   state=persisted?.secretHash===secretHash?persisted:initial(secretHash);
   if(cached()||fresh()||state.unauthorized||state.retryAt>now)return await recentResult(env,state,clock());
   if(env.MARKETDEPTH_BASE_URL&&env.MARKETDEPTH_BASE_URL!==BASE)throw new Error('INVALID_ORIGIN');
   const latest=state.rows.at(-1)?.t;
   const path='/api/v1/recent/depth'+(latest!==undefined?'?since='+encodeURIComponent(String(latest)):'');
   await authorize();
   const r=await checkResponse(await fetcher(BASE+path,{headers:{Authorization:'Bearer '+env.HISTORY_READ_TOKEN},redirect:'manual',signal:AbortSignal.timeout(10_000)}),clock());
   const payload=await r.json() as any;
   if(!payload?.ok||!isContract(payload.meta))throw new Error('RECENT_CONTRACT_MISMATCH');
   const cadence=sourceCadence(payload.meta.schema);if(payload.meta.cadenceMs!==undefined&&payload.meta.cadenceMs!==cadence)throw new Error('RECENT_CADENCE_MISMATCH');
   const rows=upstreamRows(payload.data,payload.meta.schema);
   if(!await owns(env.DB,'collector',owner,clock()))throw new Error('LEASE_EXPIRED');
   state.rows=mergeRows(state.rows,rows).filter(row=>row.t>=clock()-BUFFER_MS);
   state.connection={state:'ok',error:null,lastSuccessAtMs:clock()};state.unauthorized=false;state.retryAt=0;state.updatedAt=clock();
   state.dataAgeMs=typeof payload.meta.dataAgeMs==='number'?Math.max(0,payload.meta.dataAgeMs):null;
   state.latestTargetTsMs=Number.isSafeInteger(payload.meta.latestTargetTsMs)?payload.meta.latestTargetTsMs:state.rows.at(-1)?.t??null;
   state.pollMinMs=Number.isSafeInteger(payload.meta.pollMinMs)&&payload.meta.pollMinMs>=0?payload.meta.pollMinMs:0;
  }catch(error){
   if(error instanceof RailwayAuthRequired)throw error;
   const upstream=error instanceof UpstreamError?error:null;
   state.connection={...state.connection,state:upstream?.status===401?'unauthorized':'error',error:upstream?.code??'UPSTREAM_INVALID_OR_UNAVAILABLE'};
   if(upstream?.status===401)state.unauthorized=true;
   next=Math.max(next,clock()+(upstream?.retryMs||5000));state.retryAt=next;
  }finally{
   if(await owns(env.DB,'collector',owner,clock()))await saveSnapshot(env.DB,'v3-recent',state,clock());
   await release(env.DB,'collector',owner,Math.max(next,clock()+UPSTREAM_GAP_MS));
  }
 }
 const persisted=await readSnapshot<RecentState>(env.DB,'v3-recent');
 const current=persisted?.secretHash===secretHash?persisted:state;
 return recentResult(env,current,clock());
}
async function recentResult(env:Env,state:RecentState,now:number){
 const gate=await env.DB.prepare("SELECT next_at FROM md_gate WHERE key='collector'").first<{next_at:number}>();
 const dataAgeMs=age(state,now);
 return {ok:true as const,data:state.rows,meta:{...CONTRACT,dataAgeMs,latestTargetTsMs:state.latestTargetTsMs,stale:dataAgeMs===null||dataAgeMs>60_000,connection:state.connection,pollMinMs:state.pollMinMs??0,nextAllowedAt:Math.max(state.retryAt,gate?.next_at??0,now)}};
}
