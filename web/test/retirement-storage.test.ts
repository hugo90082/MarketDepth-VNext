import {test} from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {CONTRACT,emptyRow} from '../shared/contract';
import {initStorage,save,loadRows,loadCandles,retireProtection,refreshRecoverability,managedBlocks,removeManagedBlock,firstMissingCandle,saveVerifiedBlocks,saveVerifiedChunks} from '../src/storage';
import {blockSignature} from '../src/history-quality';
Object.defineProperty(globalThis,'localStorage',{value:{removeItem(){}}});
const t=1740000000000;
test('retirement preserves values/nulls and old cloud flags cannot authorize deletion',async()=>{
 await initStorage();const row={...emptyRow(t),cadence:60000 as const,source:'browser' as const,format:CONTRACT.datasetFormat};row.d[0][0][0]=[123.45,null];const candle={asset:'BTC' as const,interval:60000 as const,t,o:10,h:12,l:9,c:11,v:2,closed:true,complete:true,source:'binance-usdm' as const};await save([row],[candle,{...candle,asset:'ETH',source:undefined}]);
 const db=await new Promise<IDBDatabase>(resolve=>{const r=indexedDB.open('marketdepth-cache',5);r.onsuccess=()=>resolve(r.result);}),tx=db.transaction(['blocks','ledger'],'readwrite');const end=new Promise<void>(resolve=>tx.oncomplete=()=>resolve());for(const name of ['blocks','ledger']){const r=tx.objectStore(name).openCursor();r.onsuccess=()=>{const c=r.result;if(c){c.update({...c.value,cloudRevision:c.value.revision,backupRevision:c.value.revision});c.continue();}};}await end;db.close();
 assert.equal(await firstMissingCandle('BTC',t,t+60000),null);
 await retireProtection();assert.deepEqual((await loadRows(t,t))[0].d[0][0][0],[123.45,null]);assert.equal((await loadCandles('BTC',t,t))[0].c,11);assert.equal(await firstMissingCandle('BTC',t,t+60000),null);await refreshRecoverability();
 const records=await managedBlocks(),byId=new Map(records.map(r=>[r.id,r]));const base=Math.floor(t/900000)*900000,known=byId.get(`history:candle:BTC:60000:${base}`)!,unknown=byId.get(`history:candle:ETH:60000:${base}`)!;
 assert.equal(known.recoverableRevision,known.revision);assert.equal(unknown.recoverableRevision,undefined);assert.equal(byId.get('history:row:'+base)!.recoverableRevision,undefined);
 await save([],[{...candle,c:10}]);assert.equal(await removeManagedBlock(known.id.slice(8),known.revision),false);assert.equal(await removeManagedBlock(unknown.id.slice(8),unknown.revision),false);
});
test('new Railway proof rechecks an unchanged previously protected block',async()=>{
 const at=t+900000,base=Math.floor(at/900000)*900000;
 await save([{...emptyRow(at),format:CONTRACT.datasetFormat,source:'railway',cadence:60000,finalVersion:7}]);
 await refreshRecoverability();
 assert.equal((await managedBlocks()).find(b=>b.id==='history:row:'+base)!.recoverableRevision,undefined);
 const chunk={id:'retirement-proof',sha256:'exact-content',startTsMs:base,endTsMs:base+900000,rowTimes:[at]};
 const mask=3<<Math.floor((at-base)/60000)*2;
 await saveVerifiedChunks([chunk]);await saveVerifiedBlocks([{base,signature:blockSignature([{...chunk,cached:true}],base),confirmedMask:mask,presentMask:mask,checkedAt:Date.now(),indexVersion:7}]);
 await refreshRecoverability();const block=(await managedBlocks()).find(b=>b.id==='history:row:'+base)!;
 assert.equal(block.recoverableRevision,block.revision);
});
