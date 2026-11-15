import {RailwayAuthRequired} from './auth';
import {minuteRows} from '../shared/minute-history';
import { mergeRows, validateRows, type ChunkMeta, type Connection, type IndexPage, type SpotRow } from '../shared/model';
import { COLLECTION, CONTRACT, HISTORY_DELAY, WINDOW, isContract, type Span } from '../shared/contract';
import { claim, initialize, owns, readSnapshot, release, saveSnapshot, UPSTREAM_GAP_MS, type Env } from './db';
import { digest, decodeChunk, validateIndex, UpstreamError, pending } from './core';
import {archiveMarketRailway} from './market-history';
import {validUpstreamHealth,MINUTE_SPOT_SCHEMA,upstreamRows} from './upstream-format';

const BASE = 'https://marketdepth-production.up.railway.app';
type Round = Span & { cursor: number; version?: number; chunks: ChunkMeta[] };
export interface HistoryState {
  verified:boolean; secretHash:string; unauthorized:boolean; failures:number; conflicts:number;
  connection:Connection; index:ChunkMeta[]; indexVersion:number|null; indexed:Span|null;
  round:Round|null; oldest:number|null; retryAt:number;
}
const initial = (secretHash:string):HistoryState => ({verified:false,secretHash,unauthorized:false,failures:0,conflicts:0,connection:pending(),index:[],indexVersion:null,indexed:null,round:null,oldest:null,retryAt:0});
export async function checkResponse(r:Response,now:number) {
  if(r.ok||r.status===304)return r;
  const h=r.headers.get('retry-after');
  const retry=h?(/^\d+$/.test(h)?Number(h)*1000:Math.max(0,Date.parse(h)-now)):0;
  throw new UpstreamError(r.status,r.status===409?'INDEX_CHANGED':`HTTP_${r.status}`,retry||(r.status===429?1000:0));
}
const overlaps=(c:ChunkMeta,s:Span)=>c.endTsMs>s.from&&c.startTsMs<s.to;
export const eligibleEnd=(now:number)=>Math.floor((now-HISTORY_DELAY)/HISTORY_DELAY)*HISTORY_DELAY;
async function cached(env:Env) { return (await env.DB.prepare('SELECT id,sha FROM md_chunks').all<{id:string;sha:string}>()).results; }
export async function historyView(env:Env,spans:Span[],now=Date.now(),have?:Set<string>) {
  await initialize(env.DB);
  const s=await readSnapshot<HistoryState>(env.DB,'v3-collector');
  const chunks=(s?.index??[]).filter(c=>c.endTsMs<=eligibleEnd(now)&&spans.some(r=>overlaps(c,r)));
  const cache=new Set((await cached(env)).map(c=>c.id+':'+c.sha));
  const loaded=chunks.filter(c=>cache.has(c.id+':'+c.sha256));
  const wanted=loaded.filter(c=>!have?.has('*')&&!have?.has(c.id+':'+c.sha256));
  // Bound response size on a warm 7D cache as well as on a cold download.
  const delivering=wanted.slice(0,8),delivered=new Set(delivering.map(c=>c.id+':'+c.sha256));
  const acknowledged=(c:ChunkMeta)=>have?.has('*')||have?.has(c.id+':'+c.sha256)||delivered.has(c.id+':'+c.sha256);
  const confirmed:Span[]=[];
  if(s?.indexed) for(const r of spans) {
    let cursor=Math.max(r.from,s.indexed.from);const to=Math.min(r.to,s.indexed.to);
    for(const c of chunks.filter(c=>!cache.has(c.id+':'+c.sha256)||!acknowledged(c)).sort((a,b)=>a.startTsMs-b.startTsMs)) {
      if(c.endTsMs<=cursor||c.startTsMs>=to)continue;
      if(c.startTsMs>cursor)confirmed.push({from:cursor,to:Math.min(c.startTsMs,to)});
      cursor=Math.max(cursor,c.endTsMs);
    }
    if(cursor<to)confirmed.push({from:cursor,to});
  }
  const rows:SpotRow[]=[],deliveredChunks:{id:string;sha256:string;startTsMs:number;endTsMs:number;rowTimes:number[]}[]=[];
  for(let offset=0;offset<delivering.length;offset+=90){
    const batch=delivering.slice(offset,offset+90),verified=new Set(batch.map(c=>c.id+':'+c.sha256));
    const bodies=await env.DB.prepare(`SELECT id,sha,body FROM md_chunks WHERE id IN (${batch.map(()=>'?').join(',')})`).bind(...batch.map(c=>c.id)).all<{id:string;sha:string;body:string}>();
    for(const c of bodies.results)if(verified.has(c.id+':'+c.sha)){
      const chunk=delivering.find(meta=>meta.id===c.id&&meta.sha256===c.sha);
      if(!chunk)continue;
      const raw=chunk.schema===MINUTE_SPOT_SCHEMA?upstreamRows(JSON.parse(c.body),chunk.schema):validateRows(JSON.parse(c.body));let entries=raw;
      if(raw.some(r=>r.cadence!==60000)&&s?.verified&&s.indexVersion!==null){
        if(raw.length!==chunk.rows||raw.some(r=>r.t<chunk.startTsMs||r.t>=chunk.endTsMs))throw new Error('CACHED_CHUNK_RANGE_FAILED');
        entries=minuteRows(raw.map(r=>({...r,source:'railway',format:CONTRACT.datasetFormat})));
        await env.DB.prepare('UPDATE md_chunks SET body=? WHERE id=? AND sha=? AND body=?').bind(JSON.stringify(entries),c.id,c.sha,c.body).run();
      }
      rows.push(...entries);
      deliveredChunks.push({id:c.id,sha256:c.sha,startTsMs:chunk.startTsMs,endTsMs:chunk.endTsMs,rowTimes:entries.map(row=>row.t)});
    }
  }
  const gate=await env.DB.prepare("SELECT next_at FROM md_gate WHERE key='collector'").first<{next_at:number}>();
  return {ok:true as const,data:mergeRows([],rows),meta:{...CONTRACT,indexVersion:s?.indexVersion??null,confirmed,deliveredChunks,loadedChunkKeys:loaded.map(c=>c.id+':'+c.sha256),deliveredChunkKeys:[...delivered],receivedChunks:loaded.filter(acknowledged).length,loadedChunks:loaded.length,totalChunks:chunks.length,oldestAvailableTsMs:s?.oldest??null,connection:s?.connection??pending(),nextAllowedAt:Math.max(gate?.next_at??0,s?.retryAt??0,now),complete:spans.every(r=>confirmed.some(c=>c.from<=r.from&&c.to>=r.to)),indexReady:!!s?.indexed}};
}
/** One missing-range request advances at most one upstream operation; no visitors means no polling. */
export async function tickCollector(env:Env,spans:Span[],fetcher:typeof fetch=fetch,clock=()=>Date.now(),_rapid=true,authorize:()=>Promise<void>=async()=>{}) {
  if(!env.HISTORY_READ_TOKEN||!spans.length)return;
  await initialize(env.DB);
  const now=clock(),end=eligibleEnd(now),needed=spans.map(s=>({from:s.from,to:Math.min(s.to,end)})).filter(s=>s.from<s.to);
  if(!needed.length)return;
  if((await historyView(env,needed,now,new Set(['*']))).meta.complete)return;
  // One persisted gate serializes every Bearer request, including Recent.
  const state=await readSnapshot<HistoryState>(env.DB,'v3-collector');
  if(state?.retryAt&&state.retryAt>now)return;
  const owner=crypto.randomUUID();if(!await claim(env.DB,'collector',now,owner,45000,UPSTREAM_GAP_MS))return;
  let s:HistoryState|null=null,next=now,job='health';
  try {
    const secretHash=await digest(new TextEncoder().encode(env.HISTORY_READ_TOKEN));
    s=await readSnapshot<HistoryState>(env.DB,'v3-collector')??initial(secretHash);
    if(s.secretHash!==secretHash){s.secretHash=secretHash;s.unauthorized=false;s.verified=false;}
    if(s.unauthorized||s.retryAt>now)return;
    let path='/health',chunk:ChunkMeta|undefined;
    const cache=new Map((await cached(env)).map(c=>[c.id+':'+c.sha,c]));
    if(s.verified) {
      const indexNeeded=!s.indexed||needed.some(r=>r.from<s!.indexed!.from||r.to>s!.indexed!.to);
      if(s.round||indexNeeded) {
        job='index';s.round??={from:Math.min(now-WINDOW,...needed.map(r=>r.from)),to:end,cursor:0,chunks:[]};
        const p=new URLSearchParams({from:String(s.round.from),to:String(s.round.to),limit:'500',cursor:String(s.round.cursor)});
        if(s.round.version!==undefined)p.set('indexVersion',String(s.round.version));
        path='/api/v1/history/depth/index?'+p;
      } else {
        chunk=[...s.index].reverse().find(c=>c.endTsMs<=end&&needed.some(r=>overlaps(c,r))&&!cache.has(c.id+':'+c.sha256));
        if(!chunk)return;
        job='chunk';path='/api/v1/history/depth/chunks/'+encodeURIComponent(chunk.id);
      }
    }
    if(env.MARKETDEPTH_BASE_URL&&env.MARKETDEPTH_BASE_URL!==BASE)throw new Error('INVALID_ORIGIN');
    if(clock()>=now+45000)return; // Never dispatch after our reserved lease window.
    const headers:Record<string,string>={Authorization:'Bearer '+env.HISTORY_READ_TOKEN};
    await authorize();
    const r=await checkResponse(await fetcher(BASE+path,{headers,redirect:'manual',signal:AbortSignal.timeout(10000)}),clock());
    if(!await owns(env.DB,'collector',owner,clock()))return;
    if(job==='health') {
      const h=await r.json() as any;
      if(!validUpstreamHealth(h))throw new Error('SCHEMA_MISMATCH');
      s.verified=true;
    } else if(job==='index') {
      const p=validateIndex(await r.json() as IndexPage,s.round!.version);
      if(!isContract(p.meta))throw new Error('INVALID_INDEX_UNIT');
      if(p.nextCursor!==-1&&p.nextCursor<=s.round!.cursor)throw new Error('CURSOR_LOOP');
      const chunks=[...s.round!.chunks,...p.data];
      if(p.nextCursor===-1) {
        s.index=[...new Map(chunks.map(c=>[c.id,c])).values()].sort((a,b)=>a.startTsMs-b.startTsMs);
        s.indexVersion=p.meta.indexVersion;s.indexed={from:s.round!.from,to:s.round!.to};s.round=null;s.conflicts=0;
        const oldest=(p.meta as any).oldestAvailableTsMs;
        s.oldest=Number.isSafeInteger(oldest)?oldest:s.index[0]?.startTsMs??null;
      } else s.round={...s.round!,cursor:p.nextCursor,version:p.meta.indexVersion,chunks};
    } else {
      const known=cache.has(chunk!.id+':'+chunk!.sha256)?await env.DB.prepare('SELECT body FROM md_chunks WHERE id=? AND sha=?').bind(chunk!.id,chunk!.sha256).first<{body:string}>():null;
      if(r.status===304&&!known)throw new Error('304_WITHOUT_CACHE');
      const rows=r.status===304?validateRows(JSON.parse(known!.body)):await decodeChunk(await r.arrayBuffer(),chunk!);
      const minutes=minuteRows(rows.map(row=>({...row,source:'railway',format:CONTRACT.datasetFormat})));
      await env.DB.prepare('INSERT OR REPLACE INTO md_chunks(id,sha,start_ts,body) VALUES(?,?,?,?)').bind(chunk!.id,chunk!.sha256,chunk!.startTsMs,JSON.stringify(minutes)).run();
      await archiveMarketRailway(env,minutes,s.indexVersion).catch(()=>saveSnapshot(env.DB,'market-history-archive-error','Railway 快取的雲端索引寫入失敗，原快取保留。',clock()).catch(()=>{}));
    }
    s.failures=0;s.retryAt=0;s.connection={state:'ok',error:null,lastSuccessAtMs:clock()};
  } catch(e) {
    if(e instanceof RailwayAuthRequired)throw e;
    if(s) {
      s.connection={...s.connection,state:e instanceof UpstreamError&&e.status===401?'unauthorized':'error',error:e instanceof UpstreamError?e.code:'UPSTREAM_INVALID_OR_UNAVAILABLE'};
      if(e instanceof UpstreamError&&e.status===401)s.unauthorized=true;
      next=Math.max(next,clock()+(e instanceof UpstreamError&&e.retryMs?e.retryMs:Math.min(60000,5000*2**Math.min(s.failures++,4))));
      if(job==='index'&&e instanceof UpstreamError&&e.status===409){s.round=null;s.conflicts++;s.failures=0;next=clock()+(s.conflicts>=3?30000:0);}
      else if(job==='index'&&!(e instanceof UpstreamError))s.round=null;
      if(job==='chunk'&&e instanceof UpstreamError&&e.status===404){s.indexed=null;s.round=null;}
      s.retryAt=next;
    }
  } finally {
    if(s&&await owns(env.DB,'collector',owner,clock()))await saveSnapshot(env.DB,'v3-collector',s,clock());
    // Measure the safety gap from completion, not from an earlier D1 claim;
    // preflight work and network latency must not compress the next interval.
    await release(env.DB,'collector',owner,Math.max(next,clock()+UPSTREAM_GAP_MS));
  }
}
export async function statusView(env:Env) {await initialize(env.DB);const s=await readSnapshot<HistoryState>(env.DB,'v3-collector');const gate=await env.DB.prepare("SELECT next_at FROM md_gate WHERE key='collector'").first<{next_at:number}>();return {ok:true,...CONTRACT,serverNowMs:Date.now(),connection:s?.connection??pending(),upstreamVerified:s?.verified??false,nextAllowedAt:gate?.next_at??0};}
