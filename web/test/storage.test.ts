import 'fake-indexeddb/auto';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {initStorage,save,loadRows,loadCandles,getMeta,setMeta,confirm,lease,releaseLease,saveVerifiedBlocks,saveVerifiedChunks,verifiedBlocks,verifiedChunks,locallyHeldChunkKeys} from '../src/storage';
import {CONTRACT,type StoredRow} from '../shared/contract';
import {row as legacyRow} from './helpers';
const row=(t?:number)=>({...legacyRow(t),cadence:60000 as const});
Object.defineProperty(globalThis,'localStorage',{value:{removeItem(){}}});

test('IndexedDB migration, whole Railway row priority including null, persistent reload, lease and eviction',async()=>{
 await initStorage();const t=row().t;
 const local:StoredRow={...row(t),source:'browser',format:CONTRACT.datasetFormat};
 await save([local]);assert.equal((await loadRows(t,t))[0].source,'browser');
 const recent={...row(t+60000),source:'recent',format:CONTRACT.datasetFormat,captured:Array.from({length:4},()=>[true,true,true])} as StoredRow;
 recent.d[0][0][4]=[null,null];
 await save([recent]);await save([{...row(t+60000),source:'browser',format:CONTRACT.datasetFormat}]);
 assert.equal((await loadRows(t+60000,t+60000))[0].source,'recent');
 await save([{...row(t+60000),source:'railway',format:CONTRACT.datasetFormat}]);
 assert.equal((await loadRows(t+60000,t+60000))[0].source,'railway');
 // Version 9 encoded provisional Recent as sealed (1), but retained the
 // browser capture bitmap. Decode it as Recent so a sealed chunk can replace it.
 const legacyT=t+1800000,base=Math.floor(legacyT/900000)*900000;
 const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('marketdepth-cache',5);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 const tx=db.transaction('blocks','readwrite');tx.objectStore('blocks').put({id:`row:${base}`,base,revision:1,bytes:1,raw:[[legacyT-base,legacyT+200,row(legacyT).d,1,4095,null]]});
 await new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});db.close();
 assert.equal((await loadRows(legacyT,legacyT))[0].source,'recent');
 await save([{...row(legacyT),source:'railway',format:CONTRACT.datasetFormat}]);
 assert.equal((await loadRows(legacyT,legacyT))[0].source,'railway');
 const authoritative:StoredRow={...row(t),source:'railway',format:CONTRACT.datasetFormat};authoritative.d[0][0][0]=[null,0];
 await save([authoritative]);await save([local]);assert.deepEqual((await loadRows(t,t))[0].d[0][0][0],[null,0]);
 await confirm([{from:t,to:t+60000}]);await initStorage();assert.equal((await loadRows(t,t)).length,1);assert.deepEqual(await getMeta('confirmed'),[{from:t,to:t+60000}]);
 const chunk={id:'spot-'+t,sha256:'a'.repeat(64),startTsMs:t,endTsMs:t+900000,rowTimes:[t]};
 await saveVerifiedChunks([chunk]);await saveVerifiedBlocks([{base:Math.floor(t/900000)*900000,signature:'proof',confirmedMask:1,presentMask:1,checkedAt:Date.now(),indexVersion:4}]);
 await initStorage();assert.equal((await verifiedChunks()).length,1);assert.equal((await verifiedBlocks()).length,1);
 assert.equal((await locallyHeldChunkKeys(t,t+900000)).has(chunk.id+':'+chunk.sha256),true);
 const wins=await Promise.all(['a','b','c'].map(id=>lease(id,1000)));assert.equal(wins.filter(Boolean).length,1);assert.equal(await lease('b',14999),false);assert.equal(await lease('b',16001),true);await releaseLease('a');assert.equal(await lease('c',16002),false);await releaseLease('b');assert.equal(await lease('c',16003),true);
 await save([],[{asset:'BTC',interval:60000,t:t+60000,o:1,h:2,l:1,c:2,v:1,complete:true,closed:true}]);
 assert.equal((await loadCandles('BTC',t,t+60000)).length,1);
 // Simulate quota pressure through the tracked byte budget; this is a fresh test-only DB.
 await setMeta('bytes',250*1024*1024);await save([{...local,t:t+60000}]);assert.equal((await loadRows(t,t)).length,1);assert.notEqual(await getMeta('evicted'),true);
 assert.equal((await locallyHeldChunkKeys(t,t+900000)).size,1,'unique unbacked rows are protected under pressure');
});
