import {test} from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {CONTRACT,emptyRow} from '../shared/contract';
import {marketHash} from '../shared/market-history';
import {initStorage,save,setMeta,getMeta,marketHistoryHeads,marketHistoryHead,marketHistoryContent,confirmMarketCloud,applyMarketCloud,managedBlocks,removeManagedBlock,marketHistoryMeta,scanMarketHistory,recordHistoryTransfer,historyTransferQueue} from '../src/storage';
import {integratedPaneLayout} from '../shared/pane-layout';
Object.defineProperty(globalThis,'localStorage',{value:{removeItem(){}}});
const base=1740000000000-1740000000000%900000;
const c={asset:'BTC' as const,interval:60000 as const,t:base,o:100,h:110,l:90,c:105,v:7,closed:true,complete:true,source:'binance-usdm' as const};
const f={term:11,current:()=>true};
test('pending history is durable/protected; only exact cloud content clears it and newer data invalidates confirmation',async()=>{
 await initStorage();await setMeta('collector-term',f.term);await save([{...emptyRow(base),source:'browser',format:CONTRACT.datasetFormat,cadence:60000}],[c]);
 const content=await marketHistoryContent(base),remote={...content,version:1,sha256:await marketHash(content)};
 assert.equal((await marketHistoryHead(base))!.dirty,true);const block=(await managedBlocks()).find(b=>b.id.includes('candle:BTC'))!;assert.equal(block.pending,true);assert.equal(await removeManagedBlock(block.id.slice(8),block.revision),false);
 assert.equal(await confirmMarketCloud({...remote,sha256:'wrong'},f),false);assert.equal((await marketHistoryHead(base))!.dirty,true);
 await setMeta('collector-term',12);assert.equal(await confirmMarketCloud(remote,f),false);await setMeta('collector-term',11);
 assert.equal(await confirmMarketCloud(remote,f),true);assert.equal((await marketHistoryHead(base))!.dirty,false);assert.equal((await managedBlocks()).find(b=>b.id.includes('candle:BTC'))!.marketCloudRevision,block.revision);
 await save([],[{...c,c:104}]);assert.equal((await marketHistoryHead(base))!.dirty,true);assert.equal(await confirmMarketCloud(remote,f),false);assert.equal((await managedBlocks()).find(b=>b.id.includes('candle:BTC'))!.marketCloudRevision,undefined);
 await marketHistoryMeta('market-history-batch',{id:'opaque',offered:[{base,hash:remote.sha256}]},f);assert.equal((await getMeta<any>('market-history-batch')).offered[0].hash,remote.sha256);
 assert.equal((await marketHistoryHeads()).length,1);
});
test('omitted open candle never receives a complete cloud backup marker',async()=>{
 const at=base+900000;await save([],[{...c,t:at},{...c,t:at+60000,closed:false}]);const content=await marketHistoryContent(at);
 assert.equal(content.candles.length,1);assert.equal(await confirmMarketCloud({...content,version:2,sha256:await marketHash(content)},f),true);
 const block=(await managedBlocks()).find(b=>b.id==='history:candle:BTC:60000:'+at)!;assert.equal(block.marketCloudRevision,undefined);assert.equal(block.recoverableRevision,undefined);
});
test('integrated layout enlarges only the two indicators and repeated calculation never compounds',()=>{
 const old=[702.4,132,132] as const,a=integratedPaneLayout(old),b=integratedPaneLayout(old);
 assert.deepEqual(a,b);assert.equal(a.height,1026);assert.equal(a.panes[0],702.4);assert.deepEqual(a.panes.slice(1),[145,145]);assert.ok(Math.abs(a.panes[1]-old[1]*1.1)<1);
});

test('identical closed OHLCV adopts cloud receive-time metadata while real conflicts stay protected',async()=>{
 const at=base+1800000;await save([],[{...c,t:at,observedAt:at+60015}]);
 const content=await marketHistoryContent(at),canonical={...content,candles:content.candles.map(v=>({...v,observedAt:at+60008}))},remote={...canonical,version:3,sha256:await marketHash(canonical)};
 assert.deepEqual(await applyMarketCloud(remote,f),{changed:true,acknowledged:true,conflicts:[]});assert.equal((await marketHistoryHead(at))!.dirty,false);
 await save([],[{...c,t:at,c:104,observedAt:at+60020}]);
 const conflict=await applyMarketCloud(remote,f);assert.equal(conflict.acknowledged,false);assert.deepEqual(conflict.conflicts,['BTC:'+at]);assert.equal((await marketHistoryContent(at)).candles[0].c,104);assert.equal((await marketHistoryHead(at))!.dirty,true);
});

test('cloud receipt for an older offer retains minutes written while the request was in flight',async()=>{
 const at=base+2700000;await save([],[{...c,t:at}]);const offered=await marketHistoryContent(at),remote={...offered,version:4,sha256:await marketHash(offered)};
 await save([],[{...c,t:at+60000}]);const applied=await applyMarketCloud(remote,f);
 assert.equal(applied.acknowledged,false);assert.deepEqual(applied.conflicts,[]);assert.equal((await marketHistoryContent(at)).candles.length,2);assert.equal((await marketHistoryHead(at))!.dirty,true);
});

test('partial capacity eviction invalidates complete cloud content even when another block remains',async()=>{
 const at=base+3600000;await save([{...emptyRow(at),source:'browser',format:CONTRACT.datasetFormat,cadence:60000}],[{...c,t:at}]);
 const content=await marketHistoryContent(at),remote={...content,version:5,sha256:await marketHash(content)};await applyMarketCloud(remote,f);
 const own=(await managedBlocks()).find(b=>b.id==='history:row:'+at)!;assert.equal(await removeManagedBlock(own.id.slice(8),own.revision),true);
 assert.ok(await marketHistoryHead(at));assert.notEqual(await marketHash(await marketHistoryContent(at)),(await getMeta<any>('market-history-seen:'+at)).hash);
 assert.equal((await applyMarketCloud(remote,f)).acknowledged,true);assert.equal((await marketHistoryContent(at)).rows.length,1);
});

test('designation scan ignores old discovery, resumes across calls and re-enumerates outside chart range',async()=>{
 await setMeta('market-history-discovered',true);let scan=await scanMarketHistory('primary-A',f,2);assert.equal(scan.scanned,2);assert.equal(scan.complete,false);
 while(!scan.complete)scan=await scanMarketHistory('primary-A',f,2);assert.equal(scan.scanned,(await marketHistoryHeads()).length);assert.ok((await historyTransferQueue('primary-A')).pending.some(h=>h.base===base));
 const again=await scanMarketHistory('primary-A',f,2);assert.deepEqual(again,scan);
 const rebound=await scanMarketHistory('primary-B',f,2);assert.equal(rebound.scanned,2);assert.equal(rebound.assignment,'primary-B');
});
test('processed offers suppress a fixed revision only and never grant cleanup proof',async()=>{
 const at=base+5400000;await save([{...emptyRow(at),source:'browser',format:CONTRACT.datasetFormat,cadence:60000}]);const head=(await marketHistoryHead(at))!;
 const value={key:head.key,assignment:'primary-A',version:10,hash:'a'.repeat(64),outcome:'values-saved' as const,at:Date.now()};assert.ok(await recordHistoryTransfer(at,value,f));
 assert.equal((await historyTransferQueue('primary-A')).pending.some(h=>h.base===at),false);assert.equal((await historyTransferQueue('primary-A')).counts.valuesSaved,1);assert.equal((await historyTransferQueue('primary-B')).pending.some(h=>h.base===at),true);
 const own=(await managedBlocks()).find(h=>h.id==='history:row:'+at)!;assert.equal(own.marketCloudRevision,undefined);assert.equal(await removeManagedBlock(own.id.slice(8),own.revision),false);
 await save([{...emptyRow(at+60000),source:'browser',format:CONTRACT.datasetFormat,cadence:60000}]);assert.equal(await recordHistoryTransfer(at,value,f),false);assert.equal((await historyTransferQueue('primary-A')).pending.some(h=>h.base===at),true);
});
