import {test} from 'node:test';import assert from 'node:assert/strict';import {gzipSync} from 'node:zlib';
import {database,environment,response,row,health} from './helpers';
import {tickCollector,historyView,type HistoryState} from '../worker/history';
import {readSnapshot} from '../worker/db';import {digest} from '../worker/core';import {recentGapView} from '../worker/recent';
import {CONTRACT} from '../shared/contract';import {minuteRows} from '../shared/minute-history';
import {validUpstreamHealth,upstreamRows} from '../worker/upstream-format';
const minuteSchema='MD-SPOT-60S-USD-1',base=1793496600000,span={from:base,to:base+900000};
const minuteHealth={...health,schema:'MARKET_DEPTH_COLLECTION_60S_5ZONE_USD_1',spotSchema:minuteSchema,spotCadenceMs:60000};
test('minute support rejects unknown schemas, wrong units, cadence mismatches and off-grid rows',()=>{
 assert.equal(validUpstreamHealth({...minuteHealth,depthUnit:'QTY'}),false);assert.equal(validUpstreamHealth({...minuteHealth,spotCadenceMs:30000}),false);
 assert.throws(()=>upstreamRows([row(base+30000)],minuteSchema));assert.throws(()=>upstreamRows([row(base)],'MD-SPOT-UNKNOWN'));assert.throws(()=>upstreamRows([{...row(base),cadence:30000}],minuteSchema));
});
test('current Railway minute health is accepted without weakening the quote policy',async()=>{
 const {db}=database(),env=environment(db);await tickCollector(env,[span],async()=>response(minuteHealth),()=>base+3600000);
 assert.equal((await readSnapshot<HistoryState>(db,'v3-collector'))?.connection.state,'ok');
});
test('an already verified legacy collector resumes minute index/chunks and preserves every minute and null',async()=>{
 const {db}=database(),env=environment(db);let now=base+3600000;await tickCollector(env,[span],async()=>response(health),()=>now);now+=1000;
 const rows=Array.from({length:15},(_,i)=>row(base+i*60000));rows[2].d[0][0][0][0]=null;rows[3].d[0][0][0][0]=0;
 const bytes=gzipSync(rows.map(r=>JSON.stringify(r)).join('\n')),buffer=new Uint8Array(bytes).buffer,meta={id:'spot-'+base,kind:'spot',schema:minuteSchema,startTsMs:base,endTsMs:span.to,rows:15,bytes:bytes.length,sha256:await digest(buffer)};
 const index={ok:true,data:[meta],nextCursor:-1,meta:{...CONTRACT,schema:'MD-HISTORY-INDEX-3',indexVersion:2,indexUpdatedTsMs:now}};
 await tickCollector(env,[span],async()=>response(index),()=>now);assert.equal((await readSnapshot<HistoryState>(db,'v3-collector'))?.connection.state,'ok','new index must not leave an old active job retrying forever');now+=1000;
 await tickCollector(env,[span],async()=>new Response(buffer),()=>now);const view=await historyView(env,[span],now);assert.equal(view.meta.complete,true);assert.equal(view.data.length,15);assert.ok(view.data.every(r=>r.cadence===60000));
 assert.deepEqual(minuteRows(view.data as any).map(r=>r.d),rows.map(r=>r.d));
});
test('minute Recent marks the declared cadence before browser conversion and keeps raw values',async()=>{
 const {db}=database(),env=environment(db),value=row(base);const got=await recentGapView(env,async()=>response({ok:true,data:[value],meta:{...CONTRACT,schema:minuteSchema,cadenceMs:60000,pollMinMs:0,latestTargetTsMs:base,dataAgeMs:0}}),()=>base+1000,base);
 assert.equal(got.ok,true);if(!got.ok)return;assert.equal(got.meta.connection.state,'ok');assert.equal(got.data[0]?.cadence,60000);assert.deepEqual(minuteRows(got.data as any)[0]?.d,value.d);
});
