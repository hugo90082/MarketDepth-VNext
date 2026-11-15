import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { claim,release,readSnapshot,saveSnapshot,initialize } from '../worker/db';
import { decodeChunk,digest,validateIndex } from '../worker/core';
import { historyView,tickCollector,eligibleEnd,type HistoryState } from '../worker/history';
import worker from '../worker/index';
import { database,environment,health,response,row,authorizedRequest } from './helpers';
import { CONTRACT } from '../shared/contract';
import { startJob, viewJob } from '../worker/jobs';
import type { ChunkMeta } from '../shared/model';
import { recentGapView } from '../worker/recent';
import {exchangeView} from '../worker/exchanges';
const span={from:row().t,to:row().t+30000};
async function fixture(){const {db,raw}=database(),env=environment(db);let now=row().t+3600000;await tickCollector(env,[span],async()=>response(health),()=>now);now+=60000;return {db,raw,env,get now(){return now},advance(ms=60000){now+=ms;}};}
async function chunk(){const r=row(),bytes=gzipSync(JSON.stringify(r)+'\n'),buffer=new Uint8Array(bytes).buffer;const meta:ChunkMeta={id:'spot-'+r.t,kind:'spot',schema:CONTRACT.schema,startTsMs:r.t,endTsMs:r.t+900000,rows:1,bytes:bytes.length,sha256:await digest(buffer)};return {r,meta,buffer};}
function page(data:ChunkMeta[],version=1,nextCursor=-1){return {ok:true as const,data,nextCursor,meta:{...CONTRACT,schema:'MD-HISTORY-INDEX-3',indexVersion:version,indexUpdatedTsMs:version}};}

test('reserve global budget before I/O; crash and wrong owner cannot reset it',async()=>{const {db}=database();const wins=await Promise.all(Array.from({length:20},(_,i)=>claim(db,'collector',1000,String(i))));assert.equal(wins.filter(Boolean).length,1);await release(db,'collector','wrong',0);assert.equal(await claim(db,'collector',46001,'new'),false);assert.equal(await claim(db,'collector',61000,'new'),true);});
test('in-flight collector is serialized and retains a 600 ms shared rate gap',async()=>{
 const {db}=database(),env=environment(db);let now=row().t+3600000,calls=0;let finish:(r:Response)=>void=()=>{};let started:()=>void=()=>{};const reached=new Promise<void>(r=>{started=r;});
 const pending=tickCollector(env,[span],async()=>{calls++;started();return new Promise<Response>(r=>{finish=r;});},()=>now);
 await reached;const gate=await db.prepare("SELECT next_at,lease_until FROM md_gate WHERE key='collector'").first<{next_at:number;lease_until:number}>();assert.equal(gate?.next_at,now+600);assert.equal(gate?.lease_until,now+45000);
 now+=30000;await tickCollector(env,[span],async()=>{calls++;return response(health);},()=>now);assert.equal(calls,1);
 finish(response(health));await pending;assert.equal((await db.prepare("SELECT next_at FROM md_gate WHERE key='collector'").first<{next_at:number}>())?.next_at,now+600);
});
test('startup preserves historical rows, snapshots and the request gate',async()=>{const {db,raw}=database();await saveSnapshot(db,'collector',{verified:true},0);await claim(db,'collector',1000,'old');raw.prepare('INSERT INTO md_chunks VALUES(?,?,?,?)').run('old','old',0,'[]');await initialize(db);assert.deepEqual(await readSnapshot(db,'collector'),{verified:true});assert.equal(raw.prepare('SELECT * FROM md_chunks').all().length,1);assert.equal(await claim(db,'collector',2000,'new'),false);await saveSnapshot(db,'v3-test',{keep:true},0);await initialize(db);assert.deepEqual(await readSnapshot(db,'v3-test'),{keep:true});});
test('many browser requests make exactly one index call, never Recent',async()=>{const f=await fixture();let calls=0;const fetcher:typeof fetch=async input=>{calls++;assert.match(String(input),/history\/depth\/index/);return response(page([]));};await Promise.all(Array.from({length:30},()=>tickCollector(f.env,[span],fetcher,()=>f.now)));assert.equal(calls,1);f.advance();await tickCollector(f.env,[span],fetcher,()=>f.now);assert.equal(calls,1);});
test('incomplete live rows share a short Recent cache without the retired 30-second cooldown',async()=>{
 const {db}=database(),env=environment(db);let now=row().t+30000,calls=0;
 const fetcher:typeof fetch=async(input,init)=>{calls++;assert.match(String(input),calls===1?/\/api\/v1\/recent\/depth$/:new RegExp(`since=${row().t}$`));assert.match(new Headers(init?.headers).get('authorization')??'',/^Bearer /);return response({ok:true,data:[row()],meta:{...CONTRACT,schema:CONTRACT.schema,pollMinMs:0,dataAgeMs:0,latestTargetTsMs:row().t}});};
 const first=await recentGapView(env,fetcher,()=>now);if(!first.ok)assert.fail('Recent cache unavailable');assert.equal(first.data.length,1);assert.equal(calls,1);
 now+=1000;const shared=await Promise.all(Array.from({length:20},()=>recentGapView(env,fetcher,()=>now)));assert.equal(calls,1);assert.ok(shared.every(view=>view.ok&&view.data.length===1));
 now+=1000;await recentGapView(env,fetcher,()=>now);assert.equal(calls,2);
 now+=2000;await recentGapView(env,fetcher,()=>now,row().t);assert.equal(calls,2);
});
test('Recent resets its cursor after token rotation without using an old cache',async()=>{
 const {db}=database(),env=environment(db);let now=row().t+30000,calls=0;
 const fetcher:typeof fetch=async input=>{calls++;assert.match(String(input),/recent\/depth$/);return response({ok:true,data:[row()],meta:{...CONTRACT,pollMinMs:0,dataAgeMs:0,latestTargetTsMs:row().t}});};
 await recentGapView(env,fetcher,()=>now);env.HISTORY_READ_TOKEN='rotated';now+=2000;
 await recentGapView(env,fetcher,()=>now);assert.equal(calls,2);
});
test('Historical and Recent share one rolling-window gate',async()=>{
 const f=await fixture();let historyCalls=0,recentCalls=0;
 await tickCollector(f.env,[span],async()=>{historyCalls++;return response(page([],7,1));},()=>f.now);
 const recentFetch:typeof fetch=async()=>{recentCalls++;return response({ok:true,data:[row()],meta:{...CONTRACT,pollMinMs:0,dataAgeMs:0,latestTargetTsMs:row().t}});};
 await recentGapView(f.env,recentFetch,()=>f.now);f.advance(599);await recentGapView(f.env,recentFetch,()=>f.now);
 assert.equal(recentCalls,0);
 f.advance(1);await recentGapView(f.env,recentFetch,()=>f.now);assert.equal(recentCalls,1);
 await tickCollector(f.env,[span],async()=>{historyCalls++;return response(page([],7));},()=>f.now);assert.equal(historyCalls,1);
 f.advance(600);await tickCollector(f.env,[span],async()=>{historyCalls++;return response(page([],7));},()=>f.now);assert.equal(historyCalls,2);
});
test('simultaneous Historical and Recent visitors dispatch only one Railway request',async()=>{
 const {db}=database(),env=environment(db),now=row().t+3600000;let calls=0;
 await Promise.all([
  tickCollector(env,[span],async()=>{calls++;return response(health);},()=>now),
  recentGapView(env,async()=>{calls++;return response({ok:true,data:[row()],meta:{...CONTRACT,pollMinMs:0,dataAgeMs:0,latestTargetTsMs:row().t}});},()=>now),
 ]);
 assert.equal(calls,1);
});
test('Recent 429 waits Retry-After 1 and retries the same since cursor',async()=>{
 const {db}=database(),env=environment(db);let now=row().t+30000,calls=0;
 const fetcher:typeof fetch=async input=>{calls++;if(calls===1)return response({},429,{'Retry-After':'1'});assert.match(String(input),/recent\/depth$/);return response({ok:true,data:[row()],meta:{...CONTRACT,pollMinMs:0,dataAgeMs:0,latestTargetTsMs:row().t}});};
 await recentGapView(env,fetcher,()=>now);now+=999;await recentGapView(env,fetcher,()=>now);assert.equal(calls,1);
 now+=1;await recentGapView(env,fetcher,()=>now);assert.equal(calls,2);
 await recentGapView(env,fetcher,()=>now,row().t);assert.equal(calls,2);
});
test('recent unsealed gaps and empty demands cause zero calls',async()=>{const {db}=database(),env=environment(db);const now=Date.now();let calls=0;const fetcher:typeof fetch=async()=>{calls++;return response(health);};await tickCollector(env,[],fetcher,()=>now);await tickCollector(env,[{from:eligibleEnd(now),to:now}],fetcher,()=>now);assert.equal(calls,0);});
test('401 stops requests until token changes',async()=>{const f=await fixture();let calls=0;await tickCollector(f.env,[span],async()=>{calls++;return response({},401);},()=>f.now);f.advance(180000);await tickCollector(f.env,[span],async()=>{calls++;return response(health);},()=>f.now);assert.equal(calls,1);f.env.HISTORY_READ_TOKEN='rotated';f.advance();await tickCollector(f.env,[span],async()=>{calls++;return response(health);},()=>f.now);assert.equal(calls,2);});
test('429 respects Retry-After longer than one minute',async()=>{const f=await fixture();let calls=0;const fetcher:typeof fetch=async()=>{calls++;return response({},429,{'Retry-After':'120'});};await tickCollector(f.env,[span],fetcher,()=>f.now);f.advance(119000);await tickCollector(f.env,[span],fetcher,()=>f.now);assert.equal(calls,1);f.advance(1000);await tickCollector(f.env,[span],fetcher,()=>f.now);assert.equal(calls,2);});
test('pinned pagination retries 409 from first page and excludes purged chunks',async()=>{const f=await fixture(),c=await chunk();await f.db.prepare('INSERT INTO md_chunks VALUES(?,?,?,?)').bind(c.meta.id,c.meta.sha256,c.meta.startTsMs,JSON.stringify([c.r])).run();await tickCollector(f.env,[span],async input=>{assert.ok(!String(input).includes('indexVersion'));return response(page([c.meta],7,1));},()=>f.now);assert.equal((await readSnapshot<HistoryState>(f.db,'v3-collector'))?.indexVersion,null);f.advance();await tickCollector(f.env,[span],async input=>{assert.match(String(input),/indexVersion=7/);return response({},409);},()=>f.now);assert.equal((await readSnapshot<HistoryState>(f.db,'v3-collector'))?.round,null);f.advance();await tickCollector(f.env,[span],async input=>{assert.ok(!String(input).includes('indexVersion'));return response(page([],8));},()=>f.now);assert.equal((await historyView(f.env,[span],f.now)).data.length,0);assert.equal(f.raw.prepare('SELECT * FROM md_chunks').all().length,1);});
test('three conflicts back off without infinite pagination',async()=>{const f=await fixture();let calls=0;for(let i=0;i<3;i++){await tickCollector(f.env,[span],async()=>{calls++;return response({},409);},()=>f.now);if(i<2)f.advance();}f.advance(29999);await tickCollector(f.env,[span],async()=>{calls++;return response(page([]));},()=>f.now);assert.equal(calls,3);});
test('gzip SHA, partial chunk, null priority, immutable cache and no repeated download',async()=>{const f=await fixture(),c=await chunk();assert.deepEqual(await decodeChunk(c.buffer,c.meta),[c.r]);await assert.rejects(decodeChunk(c.buffer,{...c.meta,sha256:'0'.repeat(64)}));await tickCollector(f.env,[span],async()=>response(page([c.meta])),()=>f.now);f.advance();let calls=0;await tickCollector(f.env,[span],async()=>{calls++;return new Response(c.buffer);},()=>f.now);const view=await historyView(f.env,[span],f.now);assert.equal(view.data.length,1);assert.equal(view.meta.complete,true);const received=await historyView(f.env,[span],f.now,new Set(view.meta.loadedChunkKeys));assert.equal(received.data.length,0);assert.equal(received.meta.complete,true);f.advance();await tickCollector(f.env,[span],async()=>{calls++;return new Response(c.buffer);},()=>f.now);assert.equal(calls,1);});
test('304 without verified cache is rejected',async()=>{const f=await fixture(),c=await chunk();await tickCollector(f.env,[span],async()=>response(page([c.meta])),()=>f.now);f.advance();await tickCollector(f.env,[span],async()=>new Response(null,{status:304}),()=>f.now);assert.equal((await historyView(f.env,[span],f.now)).data.length,0);assert.equal((await readSnapshot<HistoryState>(f.db,'v3-collector'))?.connection.state,'error');});
test('404 invalidates index and 5xx/network failures preserve validated cache',async()=>{const f=await fixture(),c=await chunk();await tickCollector(f.env,[span],async()=>response(page([c.meta])),()=>f.now);f.advance();await tickCollector(f.env,[span],async()=>response({},404),()=>f.now);assert.equal((await readSnapshot<HistoryState>(f.db,'v3-collector'))?.indexed,null);f.advance();await tickCollector(f.env,[span],async()=>{throw new Error('secret must not escape');},()=>f.now);const s=await readSnapshot<HistoryState>(f.db,'v3-collector');assert.ok(!JSON.stringify(s?.connection).includes('secret'));});
test('reject old schemas, wrong policies, and non-increasing cursor',async()=>{assert.throws(()=>validateIndex({...page([]),meta:{...page([]).meta,schema:'MD-HISTORY-INDEX-2'}}));assert.throws(()=>validateIndex({...page([]),meta:{...page([]).meta,depthUnit:'QTY'}} as any));const f=await fixture();await tickCollector(f.env,[span],async()=>response(page([],1,0)),()=>f.now);assert.equal((await readSnapshot<HistoryState>(f.db,'v3-collector'))?.indexed,null);});
test('legacy routes and HEAD never schedule upstream; invalid range rejected; noindex and no secrets',async()=>{const {db}=database(),env=environment(db),ctx={waitUntil(){throw new Error('No background work');}} as unknown as ExecutionContext;for(const path of ['/api/depth/recent','/api/depth/history','/api/klines','/api/depth/backfill']){const r=await worker.fetch(await authorizedRequest(env,'https://site.test'+path),env,ctx);assert.equal(r.status,410);}const head=await worker.fetch(await authorizedRequest(env,'https://site.test/api/depth/backfill',{method:'HEAD'}),env,ctx);assert.equal(head.status,405);const bad=await worker.fetch(await authorizedRequest(env,'https://site.test/api/depth/backfill/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({hours:169})}),env,ctx);assert.equal(bad.status,400);const r=await worker.fetch(await authorizedRequest(env,'https://site.test/api/status'),env,ctx);assert.match(r.headers.get('x-robots-tag')??'',/noindex/);assert.ok(!(await r.text()).includes(env.HISTORY_READ_TOKEN));assert.equal((await readSnapshot<HistoryState>(db,'v3-collector')),null);});
test('Bitfinex P1 fallback bypasses old P0 cache without touching Railway',async()=>{
 const {db}=database(),env=environment(db),now=Date.now();let requests=0;
 await saveSnapshot(db,'v3-exchange-bitfinex-near-BTC',{data:'old P0',receivedAtMs:now},now);
 const view=await exchangeView(env,'bitfinex-near','BTC',async input=>{
  requests++;assert.match(String(input),/\/tBTCUSD\/P1\?len=250$/);
  return response([[99,1,2],[101,1,-3]]);
 },now);
 assert.equal(requests,1);
 assert.notEqual(view.data,'old P0');
 assert.equal((await readSnapshot<any>(db,'v3-exchange-p1p2-bitfinex-near-BTC'))?.kind,'bitfinex-near');
 assert.equal((await readSnapshot<any>(db,'v3-exchange-bitfinex-near-BTC'))?.data,'old P0');
});
test('invalid Recent target cannot dispatch an upstream request',async()=>{
 const {db}=database(),env=environment(db);
 const result=await worker.fetch(await authorizedRequest(env,'https://site.test/api/depth/live-gap?target=abc'),env,{} as ExecutionContext);
 assert.equal(result.status,400);
 assert.equal((await db.prepare("SELECT next_at FROM md_gate WHERE key='collector'").first()),null);
});
test('jobs extend the active range and reuse a completed comparison until new history is sealed',async()=>{
 const {db,raw}=database(),env=environment(db),now=row().t+3600000,client=crypto.randomUUID();
 const first=await startJob(env,client,1,now);assert.equal(first.job.to_ts<=eligibleEnd(now),true);
 const again=await startJob(env,client,4,now+1000);assert.equal(again.job.id,first.job.id);assert.ok(again.job.from_ts<first.job.from_ts);
 const view=await viewJob(env,first.job.id,client,now);assert.equal(view?.data.length,0);assert.equal(view?.job.complete,false);
 assert.equal(await viewJob(env,first.job.id,crypto.randomUUID(),now),null);
 raw.prepare('UPDATE md_jobs SET completed_at=? WHERE id=?').run(now+2000,first.job.id);
 assert.equal((await startJob(env,client,4,now+299000)).cooldownUntil,0);
 const later=await startJob(env,client,4,now+300000);assert.equal(later.job.id,first.job.id);
 const newlySealed=await startJob(env,client,4,now+900000);assert.notEqual(newlySealed.job.id,first.job.id);
 assert.equal((await db.prepare("SELECT next_at FROM md_gate WHERE key='collector'").first()),null);
});

test('manual comparison accepts up to 7D and rejects longer ranges',async()=>{
 for(const hours of [8,12,24,48,72,120,168]){
  const {db}=database(),env=environment(db),now=row().t+48*3600000;
  const job=await startJob(env,crypto.randomUUID(),hours,now);
  assert.equal(job.job.to_ts-job.job.from_ts<=hours*3600000,true);
  assert.equal(job.job.to_ts-job.job.from_ts>(hours-1)*3600000,true);
 }
 const {db}=database(),env=environment(db);
 await assert.rejects(startJob(env,crypto.randomUUID(),169),/BAD_RANGE/);
});

test('active manual work advances without a minute pause but respects 429 Retry-After',async()=>{
 const f=await fixture();let calls=0;
 const fetcher:typeof fetch=async()=>{calls++;return response({},429,{'Retry-After':'120'});};
 await tickCollector(f.env,[span],fetcher,()=>f.now,true);
 f.advance(1000);await tickCollector(f.env,[span],fetcher,()=>f.now,true);
 assert.equal(calls,1);
 f.advance(119000);await tickCollector(f.env,[span],fetcher,()=>f.now,true);
 assert.equal(calls,2);
});

test('manual pagination continues after the shared 600 ms gap',async()=>{
 const f=await fixture();let calls=0;
 await tickCollector(f.env,[span],async()=>{calls++;return response(page([],7,1));},()=>f.now,true);
 f.advance(599);await tickCollector(f.env,[span],async()=>{calls++;return response(page([],7));},()=>f.now,true);assert.equal(calls,1);
 f.advance(1);
 await tickCollector(f.env,[span],async()=>{calls++;return response(page([],7));},()=>f.now,true);
 assert.equal(calls,2);
 assert.equal((await historyView(f.env,[span],f.now)).meta.complete,true);
});
test('index 429 waits one second and resumes the same pinned page',async()=>{
 const f=await fixture();let calls=0;
 await tickCollector(f.env,[span],async()=>{calls++;return response(page([],7,1));},()=>f.now);
 f.advance(600);await tickCollector(f.env,[span],async input=>{calls++;assert.match(String(input),/cursor=1/);return response({},429,{'Retry-After':'1'});},()=>f.now);
 assert.equal((await readSnapshot<HistoryState>(f.db,'v3-collector'))?.round?.cursor,1);
 f.advance(999);await tickCollector(f.env,[span],async()=>{calls++;return response(page([],7));},()=>f.now);assert.equal(calls,2);
 f.advance(1);await tickCollector(f.env,[span],async input=>{calls++;assert.match(String(input),/cursor=1/);assert.match(String(input),/indexVersion=7/);return response(page([],7));},()=>f.now);
 assert.equal(calls,3);assert.equal((await historyView(f.env,[span],f.now)).meta.complete,true);
});


