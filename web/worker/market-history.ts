import {sessionIdentity} from './auth';
import {clientCookie,newClientCookie} from './jobs';
import {SOURCE_PATTERN,sourceCode,offerOutcome,marketCandleMasks,type MarketSource} from '../shared/market-sync';
import {claim,release,initialize,readSnapshot,saveSnapshot,type Env} from './db';
import type {HistoryState} from './history';
import {CONTRACT,type StoredRow} from '../shared/contract';
import {minuteRows} from '../shared/minute-history';
import {validateRows} from '../shared/model';
import {MARKET_BLOCK_MS,MARKET_WIRE_LIMIT,MARKET_DECODED_LIMIT,MARKET_BATCH_MS,marketContent,marketHash,railwayReadbackHash,emptyMarketBlock,mergeMarketContent,type MarketContent,type MarketBlock} from '../shared/market-history';

type Collector={id:string;client:string;session:string;expires_at:number;qualified_at:number|null;proof:string|null;last_batch_id:string|null;last_batch_hash:string|null;last_receipt:string|null};
type RecordBlock={base:number;version:number;sha:string;body:string};
const reply=(data:unknown,status=200,headers:Record<string,string>={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers}});
const failure=(code:string,status=400)=>reply({ok:false,error:{code}},status);
const parsedBlock=(r:RecordBlock):MarketBlock=>({...marketContent(JSON.parse(r.body)),version:r.version,sha256:r.sha});
async function stored(env:Env,base:number){return env.DB.prepare('SELECT base,version,sha,body FROM md_market_blocks WHERE base=?').bind(base).first<RecordBlock>();}
async function binding(request:Request,env:Env,now:number){const session=await sessionIdentity(request,env,now),client=clientCookie(request);return session&&client?{session,client,id:await marketHash([session.id,client])}:null;}
async function collector(env:Env,id:string){return env.DB.prepare('SELECT * FROM md_market_collectors WHERE id=?').bind(id).first<Collector>();}
async function sourceIdentity(request:Request,env:Env){
 const existing=clientCookie(request),client=existing??crypto.randomUUID(),code=await sourceCode(client),target=env.MARKET_HISTORY_PRIMARY_SOURCE?.trim()??'',configured=!!target,valid=!configured||SOURCE_PATTERN.test(target);
 const source:MarketSource={code,configured,valid,isPrimary:valid&&configured&&code===target,canUpload:valid&&(!configured||code===target),assignment:await marketHash(['source-assignment-v1',target])};
 const headers:Record<string,string>=existing?{}:{'Set-Cookie':newClientCookie(client)};
 if(headers['Set-Cookie']&&new URL(request.url).protocol==='http:'&&['127.0.0.1','localhost'].includes(new URL(request.url).hostname))headers['Set-Cookie']=headers['Set-Cookie'].replace('; Secure','');
 return {source,headers};
}
async function qualified(request:Request,env:Env,now:number){if(!(await sourceIdentity(request,env)).source.canUpload)return null;const b=await binding(request,env,now);if(!b)return null;const c=await collector(env,b.id);return c?.qualified_at&&c.expires_at>now&&c.expires_at<=b.session.expiresAt?{...b,collector:c}:null;}

/** Allocate the public version in the same D1 transaction as the block write. */
async function saveContent(env:Env,incoming:MarketContent,trusted=false){
 await env.DB.prepare("INSERT OR IGNORE INTO md_snapshots(key,body,updated_at) VALUES('market-history-version','0',0)").run();
 for(let attempt=0;attempt<4;attempt++){
  const old=await stored(env,incoming.base),merged=await mergeMarketContent(old?parsedBlock(old):undefined,incoming,trusted),body=JSON.stringify(merged.content),sha=await marketHash(merged.content);
  if(old?.sha===sha)return {block:parsedBlock(old),conflicts:merged.conflicts};
  const result=await env.DB.batch([
   env.DB.prepare(`INSERT INTO md_market_blocks(base,version,sha,body,updated_at) VALUES(?,(SELECT CAST(body AS INTEGER)+1 FROM md_snapshots WHERE key='market-history-version'),?,?,?)
    ON CONFLICT(base) DO UPDATE SET version=excluded.version,sha=excluded.sha,body=excluded.body,updated_at=excluded.updated_at WHERE md_market_blocks.version=?`).bind(incoming.base,sha,body,Date.now(),old?.version??0),
   env.DB.prepare("UPDATE md_snapshots SET body=CAST(CAST(body AS INTEGER)+1 AS TEXT),updated_at=? WHERE key='market-history-version' AND changes()=1").bind(Date.now()),
  ]);
  if(result[0].meta.changes)return {block:parsedBlock((await stored(env,incoming.base))!),conflicts:merged.conflicts};
 }
 throw new Error('MARKET_WRITE_CONFLICT');
}

export async function archiveMarketRailway(env:Env,rows:StoredRow[],version:number|null){
 const groups=new Map<number,StoredRow[]>();for(const r of minuteRows(rows)){const base=Math.floor(r.t/MARKET_BLOCK_MS)*MARKET_BLOCK_MS;groups.set(base,[...groups.get(base)??[],{...r,source:'railway',format:CONTRACT.datasetFormat,...(version===null?{}:{finalVersion:version})}]);}
 for(const [base,values]of groups)await saveContent(env,marketContent({...emptyMarketBlock(base),rows:values}),true);
}
/** Resume bounded import of existing verified cache; no upstream request. */
async function archiveExisting(env:Env){
 const owner=crypto.randomUUID(),now=Date.now();if(!await claim(env.DB,'market-history-archive',now,owner,30000,30000))return;
 try{
  const cursor=await readSnapshot<{start:number;id:string;sha:string;offset:number}>(env.DB,'market-history-archive-cursor')??{start:-1,id:'',sha:'',offset:0};
  const chunk=await env.DB.prepare(`SELECT id,sha,start_ts,body FROM md_chunks WHERE (start_ts>? OR (start_ts=? AND (id>? OR (id=? AND sha>=?)))) ORDER BY start_ts,id,sha LIMIT 1`).bind(cursor.start,cursor.start,cursor.id,cursor.id,cursor.sha).first<{id:string;sha:string;start_ts:number;body:string}>();
  if(!chunk){await saveSnapshot(env.DB,'market-history-archive-complete',true,now);return;}
  const rows=minuteRows(validateRows(JSON.parse(chunk.body)).map(r=>({...r,source:'railway' as const,format:CONTRACT.datasetFormat}))),same=chunk.id===cursor.id&&chunk.sha===cursor.sha,offset=same?cursor.offset:0;
  const state=await readSnapshot<HistoryState>(env.DB,'v3-collector'),version=state?.index.some(c=>c.id===chunk.id&&c.sha256===chunk.sha)?state.indexVersion:null;
  const part=rows.slice(offset,offset+120);if(part.length)await archiveMarketRailway(env,part,version);
  const complete=offset+part.length>=rows.length;
  // A lexicographic sentinel advances beyond this exact (id, hash), including empty chunks.
  await saveSnapshot(env.DB,'market-history-archive-cursor',{start:chunk.start_ts,id:chunk.id,sha:complete?chunk.sha+'~':chunk.sha,offset:complete?0:offset+part.length},now);
  await saveSnapshot(env.DB,'market-history-archive-complete',false,now);
 }finally{await release(env.DB,'market-history-archive',owner,Date.now()+30000);}
}
async function status(request:Request,env:Env,now:number){
 const identity=await sourceIdentity(request,env);
 const session=await sessionIdentity(request,env,now),b=await binding(request,env,now),c=b?await collector(env,b.id):null;
 const totals=await env.DB.prepare('SELECT MIN(base) AS oldest,MAX(base) AS newest,COUNT(*) AS blocks,COALESCE(MAX(version),0) AS version FROM md_market_blocks').first<{oldest:number|null;newest:number|null;blocks:number;version:number}>();
 const prior=session&&b?await env.DB.prepare('SELECT id FROM md_jobs WHERE client=? AND completed_at IS NOT NULL ORDER BY completed_at DESC LIMIT 1').bind(b.client).first<{id:string}>():null;
 return reply({ok:true,capability:2,source:identity.source,authenticated:!!session,eligible:identity.source.canUpload&&!!session&&!!c?.qualified_at&&c.expires_at>now&&c.expires_at<=session.expiresAt,expiresAt:c?.qualified_at&&session?Math.min(c.expires_at,session.expiresAt):null,comparisonJobId:prior?.id??null,cloud:totals,archiveComplete:await readSnapshot(env.DB,'market-history-archive-complete')===true,archiveError:await readSnapshot(env.DB,'market-history-archive-error')??null},200,identity.headers);
}
async function qualify(request:Request,env:Env,now:number){
 if(!(await sourceIdentity(request,env)).source.canUpload)return failure('NOT_DESIGNATED_SOURCE',403);
 const b=await binding(request,env,now);if(!b)return failure('LOGIN_REQUIRED',401);
 const input=await boundedBody(request) as any;if(JSON.stringify(input).length>4096)return failure('PAYLOAD_TOO_LARGE',413);
 if(input.phase==='begin'){
  if(typeof input.jobId!=='string')return failure('COMPARISON_REQUIRED',403);
  const job=await env.DB.prepare('SELECT * FROM md_jobs WHERE id=? AND client=? AND completed_at IS NOT NULL').bind(input.jobId,b.client).first<{from_ts:number;to_ts:number}>(),state=await readSnapshot<HistoryState>(env.DB,'v3-collector');
  if(!job||!state?.verified||state.unauthorized||state.indexVersion===null)return failure('COMPARISON_REQUIRED',403);
  const meta=state.index.find(c=>c.endTsMs>job.from_ts&&c.startTsMs<job.to_ts),chunk=meta?await env.DB.prepare('SELECT body FROM md_chunks WHERE id=? AND sha=?').bind(meta.id,meta.sha256).first<{body:string}>():null;
  if(!chunk||!meta)return failure('VERIFIED_CHUNK_REQUIRED',403);
  const rows=minuteRows(validateRows(JSON.parse(chunk.body)).map(r=>({...r,source:'railway' as const,format:CONTRACT.datasetFormat})));if(!rows.length)return failure('VERIFIED_CHUNK_REQUIRED',403);
  const proof={nonce:crypto.randomUUID(),jobId:input.jobId,chunk:meta.id,sha:meta.sha256,digest:await railwayReadbackHash(rows),until:now+300000};
  await env.DB.prepare(`INSERT INTO md_market_collectors(id,client,session,expires_at,proof) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET proof=excluded.proof`).bind(b.id,b.client,b.session.id,b.session.expiresAt,JSON.stringify(proof)).run();
  return reply({ok:true,nonce:proof.nonce,jobId:input.jobId,from:meta.startTsMs,to:meta.endTsMs,chunkId:meta.id,sha256:meta.sha256,indexVersion:state.indexVersion});
 }
 if(input.phase==='confirm'){
  const c=await collector(env,b.id),proof=c?.proof?JSON.parse(c.proof):null;
  if(!proof||proof.until<=now||proof.nonce!==input.nonce||proof.digest!==input.digest)return failure('READBACK_NOT_VERIFIED',403);
  const result=await env.DB.prepare('UPDATE md_market_collectors SET qualified_at=?,proof=NULL WHERE id=? AND expires_at>? AND proof=?').bind(now,b.id,now,c!.proof).run();
  if(!result.meta.changes)return failure('READBACK_NOT_VERIFIED',403);
  return reply({ok:true,eligible:true,expiresAt:b.session.expiresAt});
 }
 return failure('BAD_QUALIFICATION');
}
async function boundedBody(request:Request){
 const wireReader=request.body?.getReader(),wireParts:Uint8Array[]=[];let wireSize=0;
 if(!wireReader)throw new Error('INVALID_BATCH');
 try{for(;;){const {done,value}=await wireReader.read();if(done)break;wireSize+=value.byteLength;if(wireSize>MARKET_WIRE_LIMIT)throw new Error('PAYLOAD_TOO_LARGE');wireParts.push(value);}}finally{await wireReader.cancel().catch(()=>{});}
 const wire=new Uint8Array(wireSize);let offset=0;for(const p of wireParts){wire.set(p,offset);offset+=p.byteLength;}
 const encoding=request.headers.get('content-encoding');if(encoding&&encoding!=='gzip')throw new Error('BAD_ENCODING');
 const stream=encoding==='gzip'?new Blob([wire]).stream().pipeThrough(new DecompressionStream('gzip')):new Blob([wire]).stream();
 const reader=stream.getReader(),parts:Uint8Array[]=[];let total=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>MARKET_DECODED_LIMIT)throw new Error('PAYLOAD_TOO_LARGE');parts.push(value);}}finally{await reader.cancel().catch(()=>{});}
 const joined=new Uint8Array(total);let at=0;for(const p of parts){joined.set(p,at);at+=p.length;}return JSON.parse(new TextDecoder().decode(joined));
}
async function upload(request:Request,env:Env,now:number){
 const b=await qualified(request,env,now);if(!b)return failure('UPLOAD_NOT_ELIGIBLE',403);
 const raw=await boundedBody(request);
 if(typeof raw.batchId!=='string'||!/^[a-f0-9-]{36}$/.test(raw.batchId)||!Array.isArray(raw.blocks)||!raw.blocks.length||raw.blocks.length>8)return failure('INVALID_BATCH');
 const contents=raw.blocks.map((v:any)=>marketContent(v,now));if(new Set(contents.map((c:MarketContent)=>c.base)).size!==contents.length)return failure('DUPLICATE_BLOCK');
 const hash=await marketHash(contents);
 if(b.collector.last_batch_id===raw.batchId)return b.collector.last_batch_hash===hash?reply(JSON.parse(b.collector.last_receipt!)):failure('BATCH_ID_REUSED',409);
 const owner=crypto.randomUUID(),gate='market-history-upload:'+b.id;
 if(!await claim(env.DB,gate,now,owner,30000,MARKET_BATCH_MS))return reply({ok:false,error:{code:'UPLOAD_RATE_LIMIT'}},429,{'Retry-After':'30'});
 try{
  const accepted=[];
  for(const c of contents){const result=await saveContent(env,c);accepted.push({...result,outcome:offerOutcome(c,result.block,result.conflicts),offeredHash:await marketHash(c)});}
  const receipt={ok:true,batchId:raw.batchId,accepted};
  await env.DB.prepare('UPDATE md_market_collectors SET last_batch_id=?,last_batch_hash=?,last_receipt=? WHERE id=?').bind(raw.batchId,hash,JSON.stringify(receipt),b.id).run();
  return reply(receipt);
 }finally{await release(env.DB,gate,owner,Math.max(now+MARKET_BATCH_MS,Date.now()));}
}
export async function marketHistoryApi(request:Request,env:Env):Promise<Response|null>{
 const u=new URL(request.url);if(!u.pathname.startsWith('/api/market-history/'))return null;
 await initialize(env.DB);const now=Date.now();
 if(request.method==='POST'){
  if(request.headers.get('origin')!==u.origin)return failure('ORIGIN_NOT_ALLOWED',403);
  if(!request.headers.get('content-type')?.startsWith('application/json'))return failure('JSON_REQUIRED');
 }
 try{
  if(u.pathname==='/api/market-history/source'&&request.method==='GET'){const identity=await sourceIdentity(request,env);return reply({ok:true,source:identity.source},200,identity.headers);}
  if(u.pathname==='/api/market-history/status'&&request.method==='GET'){await archiveExisting(env);return status(request,env,now);}
  if(u.pathname==='/api/market-history/receipt'&&request.method==='GET'){
   const b=await qualified(request,env,now);if(!b)return failure('UPLOAD_NOT_ELIGIBLE',403);
   return b.collector.last_batch_id===u.searchParams.get('batchId')&&b.collector.last_receipt?reply(JSON.parse(b.collector.last_receipt)):failure('RECEIPT_NOT_FOUND',404);
  }
  if(u.pathname==='/api/market-history/qualification'&&request.method==='POST')return await qualify(request,env,now);
  if(u.pathname==='/api/market-history/upload'&&request.method==='POST')return await upload(request,env,now);
  if(u.pathname==='/api/market-history/index'&&request.method==='GET'){
   const from=Number(u.searchParams.get('from')),to=Number(u.searchParams.get('to')),since=Number(u.searchParams.get('since')??0);
   if(!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||from<0||to<=from||to-from>181*86400000||!Number.isSafeInteger(since)||since<0)return failure('BAD_RANGE');
   const records=(await env.DB.prepare("SELECT base,version,sha,json_extract(body,'$.candles') AS candles FROM md_market_blocks WHERE base>=? AND base<? AND version>? ORDER BY version LIMIT 128").bind(Math.floor(from/MARKET_BLOCK_MS)*MARKET_BLOCK_MS,to,since).all<{base:number;version:number;sha:string;candles:string}>()).results;
   const total=await env.DB.prepare('SELECT COUNT(*) AS total FROM md_market_blocks WHERE base>=? AND base<?').bind(Math.floor(from/MARKET_BLOCK_MS)*MARKET_BLOCK_MS,to).first<{total:number}>();
   return reply({ok:true,items:records.map(r=>({base:r.base,version:r.version,sha256:r.sha,candleMasks:marketCandleMasks(JSON.parse(r.candles),r.base)})),cursor:records.at(-1)?.version??since,more:records.length===128,total:total?.total??0});
  }
  const match=u.pathname.match(/^\/api\/market-history\/blocks\/(\d+)$/);
  if(match&&request.method==='GET'){
   const base=Number(match[1]),version=Number(u.searchParams.get('version'));if(!Number.isSafeInteger(base)||base%MARKET_BLOCK_MS||!Number.isSafeInteger(version))return failure('BAD_BLOCK');
   const record=await stored(env,base);if(!record)return failure('BLOCK_NOT_FOUND',404);if(record.version!==version)return failure('BLOCK_VERSION_CHANGED',409);return reply({ok:true,block:parsedBlock(record)});
  }
  return failure('METHOD_OR_PATH_NOT_ALLOWED',405);
 }catch(e){const code=(e as Error).message;return failure(code==='PAYLOAD_TOO_LARGE'?code:'INVALID_MARKET_REQUEST',code==='PAYLOAD_TOO_LARGE'?413:400);}
}
