import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyRow,CONTRACT,type StoredRow} from '../shared/contract';
import {minuteRows,minuteCandles,defaultInterval} from '../shared/minute-history';
import {cleanupPlan,LOCAL_LIMIT,LOCAL_TARGET} from '../shared/managed-storage';
const start=1800000000000;
const row=(t:number,bid:number|null,ask:number|null):StoredRow=>{const r={...emptyRow(t),source:'railway' as const,format:CONTRACT.datasetFormat};r.d[0][0][0]=[bid,ask];return r;};
test('minute migration averages amounts and preserves mandatory missing/null halves',()=>{
 assert.deepEqual(minuteRows([row(start,10,0),row(start+30000,0,30)])[0].d[0][0][0],[5,15]);
 assert.deepEqual(minuteRows([row(start,10,0)])[0].d[0][0][0],[null,null]);
 assert.deepEqual(minuteRows([row(start,null,0),row(start+30000,10,20)])[0].d[0][0][0],[null,10]);
 const native={...row(start,7,8),cadence:60000 as const};assert.equal(minuteRows([native])[0],native);
});
test('OHLC migration requires both complete halves and prefers existing minute',()=>{
 const a={asset:'BTC' as const,interval:30000 as const,t:start,o:10,h:12,l:9,c:11,v:2,complete:true,closed:true};const b={...a,t:start+30000,o:11,h:14,c:13,v:3};
 assert.deepEqual(minuteCandles([a,b])[0],{asset:'BTC',interval:60000,t:start,o:10,h:14,l:9,c:13,v:5,closed:true,complete:true,observedAt:0});
 assert.equal(minuteCandles([a,{...b,complete:false}]).length,0);
 const native={...a,interval:60000 as const,c:12};assert.equal(minuteCandles([a,b,native])[0],native);
});
test('long range defaults use required intervals',()=>assert.deepEqual([336,720,2160,4320].map(defaultInterval),[900000,3600000,14400000,43200000]));
test('capacity cleanup starts only over limit, protects unique and mismatched versions, oldest first',()=>{
 const each=(LOCAL_LIMIT-LOCAL_TARGET)/2+1024*1024;
 const entries=[{id:'new',at:2,bytes:each,revision:2,recoverableRevision:2},{id:'old',at:1,bytes:each,revision:1,recoverableRevision:1},{id:'unique',at:0,bytes:LOCAL_TARGET,revision:2,recoverableRevision:1}];
 assert.deepEqual(cleanupPlan(entries).ids,['old','new']);assert.equal(cleanupPlan(entries).remaining,LOCAL_TARGET);
 assert.deepEqual(cleanupPlan([{...entries[0],bytes:LOCAL_LIMIT}]).ids,[]);
 assert.deepEqual(cleanupPlan(entries.map(e=>({...e,pending:true}))).ids,[]);
 assert.deepEqual(cleanupPlan([{id:'retired-proof',at:0,bytes:LOCAL_LIMIT+1,revision:1,cloudRevision:1,backupRevision:1} as any]).ids,[]);
});

 test('8H defaults to minute candles',()=>assert.equal(defaultInterval(8),60000));
