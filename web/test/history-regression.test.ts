import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index';
import { startJob, viewJob, advanceJob, comparisonStatus } from '../worker/jobs';
import { saveSnapshot } from '../worker/db';
import { database,environment,row,authorizedRequest } from './helpers';
import {CONTRACT} from '../shared/contract';
import {acknowledgeChunks,backfillFailure} from '../shared/backfill';

test('7D cache acknowledgement does not stall once 672 real-format chunk keys are present',async()=>{
 const {db}=database(),env=environment(db),client=crypto.randomUUID();
 env.HISTORY_READ_TOKEN=''; // No network: exercise the real public handler validation.
 const {job}=await startJob(env,client,168);
 const have=Array.from({length:672},(_,i)=>`spot-${1790400000000+i*900000}:${'a'.repeat(64)}`);
 const body=JSON.stringify({have});assert.ok(body.length>50000);
 const r=await worker.fetch(await authorizedRequest(env,`https://site.test/api/depth/backfill/jobs/${job.id}/advance`,{method:'POST',headers:{'Content-Type':'application/json',Cookie:`md_client=${client}`},body}),env,{} as ExecutionContext);
 assert.equal(r.status,200,await r.text());
});

test('14D cache acknowledgements fit the existing body limit and must not silently stop manual comparison',async()=>{
 const {db}=database(),env=environment(db),client=crypto.randomUUID();env.HISTORY_READ_TOKEN='';
 const {job}=await startJob(env,client,336),have=Array.from({length:1344},(_,i)=>`spot-${1790400000000+i*900000}:${'a'.repeat(64)}`),body=JSON.stringify({have});assert.ok(body.length<262144);
 const result=await worker.fetch(await authorizedRequest(env,`https://site.test/api/depth/backfill/jobs/${job.id}/advance`,{method:'POST',headers:{'Content-Type':'application/json',Cookie:`md_client=${client}`},body}),env,{} as ExecutionContext);
 assert.equal(result.status,200,await result.text());
});

test('expanding 1H to 48H extends the active job without five-minute cooldown',async()=>{
 const {db,raw}=database(),env=environment(db),client=crypto.randomUUID(),now=1790587200000;
 const first=await startJob(env,client,1,now),expanded=await startJob(env,client,48,now+1000);
 assert.equal(expanded.job.id,first.job.id);
 assert.ok(expanded.job.from_ts<=now-47*3600000,'must include the requested older history');
 raw.prepare('UPDATE md_jobs SET completed_at=? WHERE id=?').run(now+2000,first.job.id);
 const next=await startJob(env,client,48,now+3000);
 assert.equal(next.cooldownUntil,0);
});

test('completed comparison is reused for the same sealed window, including backend absence',async()=>{
 const {db}=database(),env=environment(db),client=crypto.randomUUID(),now=1790587200000;
 const first=await startJob(env,client,4,now);
 await saveSnapshot(db,'v3-collector',{index:[],indexed:{from:first.job.from_ts,to:first.job.to_ts},indexVersion:7,oldest:first.job.from_ts,connection:{state:'ok',error:null,lastSuccessAtMs:now}},now);
 const complete=await viewJob(env,first.job.id,client,now);
 assert.equal(complete?.job.complete,true);
 assert.equal(complete?.data.length,0);
 const repeated=await startJob(env,client,4,now+1000);
 assert.equal(repeated.job.id,first.job.id,'already verified absence must not create another job');
 const again=await advanceJob(env,repeated.job.id,client,new Set());
 assert.equal(again?.job.complete,true);
 assert.equal((await db.prepare("SELECT next_at FROM md_gate WHERE key='collector'").first()),null,'repeated advance must not reserve a Railway request');
 const readOnly=await comparisonStatus(env,client,4,now+1000);
 assert.equal(readOnly.lastCompleted?.id,first.job.id);
 assert.equal(readOnly.cacheComplete,true);
 assert.equal(readOnly.chunks.length,0);
 assert.equal((await db.prepare("SELECT next_at FROM md_gate WHERE key='collector'").first()),null);
 const next=await startJob(env,client,4,now+900000);
 assert.notEqual(next.job.id,first.job.id,'a new sealed period is eligible');
});

test('stale browser POSTs cannot turn a completed no-data comparison into Railway traffic',async()=>{
 const {db}=database(),env=environment(db),client=crypto.randomUUID(),now=Date.now(),first=await startJob(env,client,1,now);
 await saveSnapshot(db,'v3-collector',{index:[],indexed:{from:first.job.from_ts,to:first.job.to_ts},indexVersion:11,oldest:first.job.from_ts,connection:{state:'ok',error:null,lastSuccessAtMs:now}},now);
 assert.equal((await viewJob(env,first.job.id,client,now))?.job.complete,true);
 for(let i=0;i<3;i++){
  const started=await worker.fetch(await authorizedRequest(env,'https://site.test/api/depth/backfill/jobs',{method:'POST',headers:{'Content-Type':'application/json',Cookie:`md_client=${client}`},body:JSON.stringify({hours:1})}),env,{} as ExecutionContext);
  assert.equal(started.status,200);assert.equal((await started.json() as any).job.id,first.job.id);
  const advanced=await worker.fetch(await authorizedRequest(env,`https://site.test/api/depth/backfill/jobs/${first.job.id}/advance`,{method:'POST',headers:{Cookie:`md_client=${client}`},body:'{}'}),env,{} as ExecutionContext);
  assert.equal(advanced.status,200);
 }
 assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM md_jobs').first<{n:number}>())?.n,1);
 assert.equal((await db.prepare("SELECT next_at FROM md_gate WHERE key='collector'").first()),null);
});

test('warm 48H cache streams in bounded batches, confirming only data the browser actually receives',async()=>{
 const {db}=database(),env=environment(db),client=crypto.randomUUID(),now=Math.floor(Date.now()/900000)*900000;
 env.HISTORY_READ_TOKEN='';
 const {job}=await startJob(env,client,48,now),index=[];
 for(let t=job.from_ts;t<job.to_ts;t+=900000){
  const c={id:'spot-'+t,sha256:'a'.repeat(64),startTsMs:t,endTsMs:t+900000};index.push(c);
  await db.prepare('INSERT INTO md_chunks VALUES(?,?,?,?)').bind(c.id,c.sha256,t,JSON.stringify([row(t)])).run();
 }
 await saveSnapshot(db,'v3-collector',{index,indexed:{from:job.from_ts,to:job.to_ts},indexVersion:1,oldest:job.from_ts,connection:{state:'ok',error:null,lastSuccessAtMs:now}},now);
 let result=(await viewJob(env,job.id,client,now))!,have=new Set<string>(),count=0;
 assert.equal(result.data.length,8);assert.equal(result.job.complete,false);
 assert.equal(result.meta.deliveredChunks.length,8);
 assert.deepEqual(result.meta.deliveredChunks[0].rowTimes,[index[0].startTsMs]);
 assert.ok(result.meta.confirmed.every(s=>s.to<=job.from_ts+8*900000));
 while(true){
  assert.ok(result.data.length<=8);count+=result.data.length;
  have=acknowledgeChunks(have,result.meta.loadedChunkKeys,result.meta.deliveredChunkKeys);
  if(result.job.complete)break;
  result=(await advanceJob(env,job.id,client,have))!;
 }
 assert.equal(count,index.length);assert.equal(have.size,index.length);
 assert.equal((await db.prepare("SELECT next_at FROM md_gate WHERE key='collector'").first()),null);
 assert.ok(result.meta.confirmed.some(s=>s.from===job.from_ts&&s.to===job.to_ts));
});

test('actual Retry-After controls retries; invalid requests stop instead of looping every minute',()=>{
 assert.equal(backfillFailure(429,'5',1000).retryAt,6000);
 assert.equal(backfillFailure(429,'120',1000).retryAt,121000);
 assert.equal(backfillFailure(400,null,1000).stop,true);
 assert.equal(backfillFailure(401,null,1000).stop,true);
 assert.equal(backfillFailure(404,null,1000).reset,true);
 assert.equal(backfillFailure(503,null,1000).retryAt,6000);
});

test('concurrent tabs merge one active job without multiplying upstream work',async()=>{
 const {db,raw}=database(),env=environment(db),client=crypto.randomUUID(),now=1790587200000;
 const jobs=await Promise.all([1,4,12,24,48,4,1,48].map(hours=>startJob(env,client,hours,now)));
 assert.equal(new Set(jobs.map(x=>x.job.id)).size,1);
 const active=raw.prepare('SELECT * FROM md_jobs WHERE completed_at IS NULL').all();assert.equal(active.length,1);
 assert.equal(active[0].from_ts,now-48*3600000);
});
