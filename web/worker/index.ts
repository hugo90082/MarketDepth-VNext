import { ASSETS, type Asset } from '../shared/model';
import { CONTRACT, WINDOW, mergeSpans, type Span } from '../shared/contract';
import { kinds, type BookKind } from '../shared/exchanges';
import { initialize, type Env } from './db';
import { historyView, statusView, tickCollector } from './history';
import { exchangeView } from './exchanges';
import { advanceJob, clientCookie, comparisonStatus, newClientCookie, startJob, viewJob } from './jobs';
import { recentGapView } from './recent';
import {authBoundary,requireRailwaySession,RailwayAuthRequired,railwayAuthResponse} from './auth';
import {monitorApi} from './monitor';
import { siteShell } from './shell';
import {marketHistoryApi} from './market-history';
import {coinbaseRelay} from './coinbase-relay';
import {resolveHave} from './backfill-ack';
import {HaveError} from '../shared/backfill-ack';
function json(data:unknown,status=200,extra:Record<string,string>={}){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow','X-Content-Type-Options':'nosniff',...extra}});}
const rates=new Map<string,{count:number;until:number}>();
export default {
 async fetch(request:Request,env:Env,_ctx:ExecutionContext):Promise<Response>{
  const url=new URL(request.url);
  try { const auth=await authBoundary(request,env);if(auth)return auth; }
  catch {return json({ok:false,error:{code:'AUTH_UNAVAILABLE'}},503);}
  if(request.method==='HEAD'&&url.pathname.startsWith('/api/'))return new Response(null,{status:405,headers:{'X-Robots-Tag':'noindex, nofollow'}});
  if(['/api/depth/recent','/api/depth/history','/api/klines','/api/depth/backfill'].includes(url.pathname))return json({ok:false,error:{code:'CLIENT_UPDATE_REQUIRED'}},410);
  if(url.pathname==='/health')return json({ok:true,service:'marketdepth-sites-v3',...CONTRACT});
  if((url.pathname==='/'||url.pathname==='/monitor'||url.pathname==='/index.html')&&(request.method==='GET'||request.method==='HEAD'))return siteShell(request,env);
  if(!url.pathname.startsWith('/api/')){const r=await env.ASSETS.fetch(request);const out=new Response(r.body,r);out.headers.set('X-Robots-Tag','noindex, nofollow');if(out.headers.get('content-type')?.includes('text/html')||url.pathname==='/'||url.pathname==='/index.html')out.headers.set('Cache-Control','no-store');return out;}
  // HEAD must never perform upstream work, even against a valid route.
  if(request.method==='HEAD')return new Response(null,{status:405,headers:{'X-Robots-Tag':'noindex, nofollow'}});
  const now=Date.now(),ip=request.headers.get('CF-Connecting-IP')??'local';let rate=rates.get(ip);
  if(!rate||rate.until<=now){rate={count:0,until:now+60000};rates.set(ip,rate);}
  if(rates.size>1000)for(const [k,v]of rates)if(v.until<=now)rates.delete(k);
  if(!url.pathname.startsWith('/api/depth/backfill/jobs')&&(++rate.count>180||rates.size>10000))return json({ok:false,error:{code:'CLIENT_RATE_LIMIT'}},429,{'Retry-After':'60'});
  try {
   const monitor=await monitorApi(request);if(monitor)return monitor;
   const relay=await coinbaseRelay(request);if(relay)return relay;
   if(!env.DB)return json({ok:false,error:{code:'STORAGE_UNAVAILABLE'}},503);
   if(url.pathname==='/api/shared'||url.pathname.startsWith('/api/shared/'))return json({ok:false,error:{code:'FEATURE_RETIRED',message:'共享功能已停用'}},410);
   const marketHistory=await marketHistoryApi(request,env);if(marketHistory)return marketHistory;
   if(url.pathname==='/api/status'&&request.method==='GET')return json(await statusView(env));
   if(url.pathname==='/api/depth/backfill/status'&&request.method==='GET'){
    const raw=url.searchParams.get('hours');
    if(!raw||!/^\d+$/.test(raw))return json({ok:false,error:{code:'BAD_RANGE'}},400);
    try{return json(await comparisonStatus(env,clientCookie(request),Number(raw)));}
    catch(e){if((e as Error).message==='BAD_RANGE')return json({ok:false,error:{code:'BAD_RANGE'}},400);throw e;}
   }
   if(url.pathname==='/api/depth/live-gap'&&request.method==='GET'){
    const raw=url.searchParams.get('target'),target=raw===null?undefined:Number(raw);
    if(raw!==null&&(target===undefined||!/^\d+$/.test(raw)||!Number.isSafeInteger(target)||target%30000||target<now-16*60000||target>now+30000))return json({ok:false,error:{code:'BAD_TARGET'}},400);
    return json(await recentGapView(env,fetch,()=>Date.now(),target,()=>requireRailwaySession(request,env)));
   }
   if(url.pathname==='/api/exchanges/depth'&&request.method==='GET'){
    const asset=url.searchParams.get('asset'),kind=url.searchParams.get('kind');
    if(!ASSETS.includes(asset as Asset)||!kinds.includes(kind as BookKind))return json({ok:false,error:{code:'BAD_QUERY'}},400);
    await initialize(env.DB);return json(await exchangeView(env,kind as BookKind,asset as Asset));
   }
   if(url.pathname==='/api/depth/backfill/jobs'&&request.method==='POST'){
    if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))return json({ok:false,error:{code:'JSON_REQUIRED'}},400);
    const raw=await request.text();if(raw.length>262144)return json({ok:false,error:{code:'BAD_RANGE'}},400);
    const body=JSON.parse(raw) as {hours:number;have?:unknown;haveCompact?:unknown};
    const have=await resolveHave(env,body);
    const known=clientCookie(request),client=known??crypto.randomUUID();
    try {const started=await startJob(env,client,body.hours);const view=await viewJob(env,started.job.id,client,Date.now(),have);return json(view,200,known?{}:{'Set-Cookie':newClientCookie(client)});}
    catch(e){if((e as Error).message==='BAD_RANGE')return json({ok:false,error:{code:'BAD_RANGE'}},400);throw e;}
   }
   const jobPath=url.pathname.match(/^\/api\/depth\/backfill\/jobs\/([a-f0-9-]{36})(\/advance)?$/);
   if(jobPath){
    const client=clientCookie(request);if(!client)return json({ok:false,error:{code:'JOB_NOT_FOUND'}},404);
    let have:Set<string>|undefined;
    if(request.method==='POST'&&jobPath[2]){
     const raw=await request.text();if(raw.length>262144)return json({ok:false,error:{code:'BAD_QUERY'}},400);
     let body;try{body=raw?JSON.parse(raw):{};}catch{return json({ok:false,error:{code:'BAD_QUERY'}},400);}
     have=await resolveHave(env,body);
    }
    const result=request.method==='GET'&&!jobPath[2]?await viewJob(env,jobPath[1],client):request.method==='POST'&&jobPath[2]?await advanceJob(env,jobPath[1],client,have,()=>requireRailwaySession(request,env)):null;
    return result?json(result):json({ok:false,error:{code:'JOB_NOT_FOUND'}},404);
   }
   return json({ok:false,error:{code:'METHOD_OR_PATH_NOT_ALLOWED'}},405);
  }catch(error){if(error instanceof HaveError)return json({ok:false,error:{code:error.code}},error.code==='ACK_INDEX_CHANGED'?409:400);if(error instanceof RailwayAuthRequired)return railwayAuthResponse(request);return json({ok:false,error:{code:'SERVICE_UNAVAILABLE'}},503);}
 }
};
