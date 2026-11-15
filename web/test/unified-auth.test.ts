import {test} from 'node:test';
import assert from 'node:assert/strict';
import {database,environment,row,response} from './helpers';
import {saveSnapshot} from '../worker/db';
import {recentGapView} from '../worker/recent';
import {tickCollector} from '../worker/history';
import {RailwayAuthRequired,requireRailwaySession} from '../worker/auth';
import {CONTRACT} from '../shared/contract';
import {digest} from '../worker/core';
const target=row().t,now=target+3600000;
test('anonymous warm Recent cache is public; actual cold Railway dispatch requires the signed session',async()=>{
 const {db}=database(),env=environment(db),request=new Request('https://site.test/api/depth/live-gap');let calls=0;
 const fetcher:typeof fetch=async()=>{calls++;return response({});};
 const authorize=()=>requireRailwaySession(request,env,now);
 await assert.rejects(()=>recentGapView(env,fetcher,()=>now,target,authorize),RailwayAuthRequired);assert.equal(calls,0);
 await saveSnapshot(db,'v3-recent',{secretHash:await digest(new TextEncoder().encode(env.HISTORY_READ_TOKEN)),unauthorized:false,retryAt:0,updatedAt:now,pollMinMs:2000,rows:[row()],connection:{state:'ok',lastSuccessAtMs:now,error:null},dataAgeMs:0,latestTargetTsMs:target},now);
 const cached=await recentGapView(env,fetcher,()=>now,target,authorize);assert.equal(cached.ok,true);assert.deepEqual((cached as any).data[0].d,row().d);assert.equal(calls,0);
});
test('warm historical chunks preserve null and never ask for password; a cold operation is denied before I/O',async()=>{
 const {db}=database(),env=environment(db),span={from:target,to:target+30000};let calls=0,checks=0;
 const auth=async()=>{checks++;throw new RailwayAuthRequired();};
 await assert.rejects(()=>tickCollector(env,[span],async()=>{calls++;return response({});},()=>now,true,auth),RailwayAuthRequired);
 assert.equal(calls,0);assert.equal(checks,1);
 const stored=row();stored.d[0][0][0]=[null,0];const chunk={id:'spot-'+target,sha256:'a'.repeat(64),kind:'spot',schema:CONTRACT.schema,startTsMs:target,endTsMs:target+900000,rows:1,bytes:1};
 await db.prepare('INSERT INTO md_chunks(id,sha,start_ts,body) VALUES(?,?,?,?)').bind(chunk.id,chunk.sha256,target,JSON.stringify([stored])).run();
 await saveSnapshot(db,'v3-collector',{index:[chunk],indexVersion:7,indexed:span,oldest:target,connection:{state:'ok',lastSuccessAtMs:now,error:null}},now);
 await tickCollector(env,[span],async()=>{calls++;return response({});},()=>now+1000,true,auth);assert.equal(checks,1);assert.equal(calls,0);
 const persisted=await db.prepare('SELECT body FROM md_chunks WHERE id=?').bind(chunk.id).first<{body:string}>();assert.deepEqual(JSON.parse(persisted!.body)[0].d[0][0][0],[null,0]);
});
