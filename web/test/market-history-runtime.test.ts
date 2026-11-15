import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {runInNewContext} from 'node:vm';
import 'fake-indexeddb/auto';
import * as storage from '../src/storage';
import {emptyRow,CONTRACT} from '../shared/contract';
import {marketHash,mergeMarketContent} from '../shared/market-history';
Object.defineProperty(globalThis,'localStorage',{value:{removeItem(){}}});
const base=1740000000000-1740000000000%900000,f={term:25,current:()=>true};
const candle={asset:'BTC' as const,interval:60000 as const,t:base,o:100,h:110,l:90,c:105,v:7,closed:true,complete:true,source:'binance-usdm' as const};
async function runtime(fetcher:typeof fetch,store=storage){
 const source=await readFile('src/market-history/runtime.ts','utf8');
 const mocks:Record<string,string>={
  '../storage':'export const {applyMarketCloud,marketHistoryMeta,marketHistoryHead,marketHistoryHeads,marketHistoryContent,getMeta,loadRows,initStorage,discoverMarketHistory,scanMarketHistory,historyTransferQueue,recordHistoryTransfer}=H.storage;',
  '../runtime/client':'export const marketRuntime={researchChannel:()=>({postMessage(){}}),collectorStamp:()=>({id:"test",epoch:25}),isCollector:()=>true,publish(){}};',
  '../local-maintenance':'export const localMaintenance={requestedHours:()=>24};',
  '../site-api':'export const AUTH_REQUIRED_EVENT="auth-required";',
 };
 const output=await build({stdin:{contents:source+'\nexport {acceptReceipt,pullWindow,run,runPull};',resolveDir:process.cwd()+'/src/market-history',loader:'ts'},bundle:true,write:false,format:'cjs',platform:'node',define:{'import.meta.env.VITE_BFF_URL':'""'},plugins:[{name:'test-boundaries',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
 const module={exports:{} as any};runInNewContext(output.outputFiles[0].text,{module,exports:module.exports,H:{storage:store},fetch:fetcher,Date,crypto,TextEncoder,AbortSignal,Response,Blob,CompressionStream,setTimeout});return module.exports;
}
test('actual receipt handling leaves newly written minutes eligible for the next batch',async()=>{
 await storage.initStorage();await storage.setMeta('collector-term',f.term);await storage.save([],[candle]);
 const content=await storage.marketHistoryContent(base),hash=await marketHash(content),head=await storage.marketHistoryHead(base);
 await storage.save([],[{...candle,t:base+60000}]);
 const h=await runtime(async()=>new Response(null,{status:404}));
 await h.acceptReceipt({batchId:'batch',accepted:[{block:{...content,version:1,sha256:hash},offeredHash:hash,outcome:'saved',conflicts:[]}]},{id:'batch',offered:[{base,hash,key:head!.key}]},f);
 assert.equal((await storage.marketHistoryHead(base))!.dirty,true);assert.equal(await storage.getMeta('market-history-conflict:'+base),undefined);
 assert.equal((await storage.historyTransferQueue('legacy')).pending.some(h=>h.base===base),true);
 assert.equal(await storage.getMeta('market-history-batch'),undefined);
});
test('actual version pull restores partially evicted depth instead of skipping a held candle',async()=>{
 const at=base+900000;await storage.save([{...emptyRow(at),cadence:60000,source:'browser',format:CONTRACT.datasetFormat}],[{...candle,t:at}]);
 const content=await storage.marketHistoryContent(at),hash=await marketHash(content),remote={...content,version:2,sha256:hash};await storage.applyMarketCloud(remote,f);
 const row=(await storage.managedBlocks()).find(b=>b.id==='history:row:'+at)!;assert.equal(await storage.removeManagedBlock(row.id.slice(8),row.revision),true);
 await storage.setMeta('market-history-pull',{hours:24,from:at,to:at+900000,cursor:0,items:[{base:at,version:2,sha256:hash}],initial:true});let reads=0;
 const h=await runtime(async()=>{reads++;return Response.json({block:remote});});await h.pullWindow(f);
 assert.equal(reads,1);assert.equal((await storage.marketHistoryContent(at)).rows.length,1);
});

test('long native candle batches stop before cloud data but retain 200 minutes for a verified empty interval',async()=>{
 let items:any[]=[];const h=await runtime(async()=>Response.json({items}));
 assert.equal(await h.marketHistoryRuntime.candleFetchBoundary(base,base+1000*60000),base+200*60000);
 items=[{base:base+900000,version:2,sha256:'known'}];assert.equal(await h.marketHistoryRuntime.candleFetchBoundary(base,base+1000*60000),base+900000);
 const unavailable=await runtime(async()=>new Response(null,{status:503}));assert.equal(await unavailable.marketHistoryRuntime.candleFetchBoundary(base,base+1000*60000),base+900000);
});

test('equal saved values with uncertified Railway provenance stop re-offering but stay protected locally',async()=>{
 const at=base+4500000,row={...emptyRow(at),cadence:60000 as const,source:'railway' as const,format:CONTRACT.datasetFormat,finalVersion:7};row.d=row.d.map(v=>v.map(a=>a.map(()=>[100,50])));await storage.save([row]);
 const content=await storage.marketHistoryContent(at),hash=await marketHash(content),head=(await storage.marketHistoryHead(at))!,canonical=(await mergeMarketContent(undefined,content)).content,remote={...canonical,version:9,sha256:await marketHash(canonical)};
 const h=await runtime(async()=>new Response(null,{status:404}));await h.acceptReceipt({batchId:'railway-offer',accepted:[{block:remote,offeredHash:hash,outcome:'values-saved',conflicts:[]}]},{id:'railway-offer',offered:[{base:at,hash,key:head.key}]},f);
 assert.equal((await storage.historyTransferQueue('legacy')).pending.some(x=>x.base===at),false);
 const original=(await storage.managedBlocks()).find(b=>b.id==='history:row:'+at)!;assert.equal(original.marketCloudRevision,undefined);assert.equal((await storage.marketHistoryContent(at)).rows[0].source,'railway');
 await storage.save([{...row,finalVersion:8}]);assert.equal((await storage.historyTransferQueue('legacy')).pending.some(x=>x.base===at),true);
});

test('two-way pull preserves the successful version prefix when the first response fails',async()=>{
 const at=base+7200000,items=[{base:at,version:20,sha256:'a'.repeat(64)},{base:at+900000,version:21,sha256:'b'.repeat(64)}];
 const content={format:'MD-MARKET-MINUTE-1',base:at+900000,rows:[],candles:[{...candle,t:at+900000}]},hash=await marketHash(content);items[1].sha256=hash;
 await storage.setMeta('market-history-pull',{hours:24,from:at,to:at+1800000,cursor:19,items,initial:true});
 let active=0,max=0;const h=await runtime(async input=>{active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,550));active--;return String(input).includes('/'+at+'?')?new Response(null,{status:503}):Response.json({block:{...content,version:21,sha256:hash}});});
 await assert.rejects(h.pullWindow(f),/讀取失敗/);assert.equal((await storage.getMeta<any>('market-history-pull')).cursor,19);assert.equal((await storage.getMeta<any>('market-history-pull')).items.length,2);assert.equal(max,2);
 assert.equal((await storage.marketHistoryContent(at+900000)).candles.length,1);
});
test('eight blocks are processed per pull and the next turn can run without a 30-second wait',async()=>{
 const at=base+10800000;const blocks=await Promise.all(Array.from({length:9},async(_,i)=>{const content={format:'MD-MARKET-MINUTE-1',base:at+i*900000,rows:[],candles:[{...candle,t:at+i*900000}]};return {...content,version:30+i,sha256:await marketHash(content)};}));
 const items=blocks.map(b=>({base:b.base,version:b.version,sha256:b.sha256}));await storage.setMeta('market-history-pull',{hours:24,from:at,to:at+9*900000,cursor:29,items,initial:true});let requests=0;
 const h=await runtime(async input=>{requests++;const key=Number(String(input).match(/blocks\/(\d+)/)![1]);return Response.json({block:blocks.find(b=>b.base===key)});});
 assert.equal(await h.pullWindow(f),true);assert.equal(requests,8);assert.equal((await storage.getMeta<any>('market-history-pull')).items.length,1);assert.equal(await h.pullWindow(f),true);assert.equal(requests,9);assert.equal((await storage.getMeta<any>('market-history-pull')).items.length,0);
});

test('depth-only cloud blocks do not reduce a missing-price repair from 200 minutes to fifteen',async()=>{
 const items=Array.from({length:14},(_,i)=>({base:base+i*900000,version:i+1,sha256:'a'.repeat(64),candleMasks:[0,0,0]}));
 const h=await runtime(async()=>Response.json({items}));
 assert.equal(await h.marketHistoryRuntime.candleFetchBoundary(base,base+1440*60000,'SOL'),base+200*60000);
});

test('price repairs stop at the selected asset actual complete minute, not a different asset or a depth-only block',async()=>{
 const items=[{base,version:1,sha256:'a'.repeat(64),candleMasks:[32767,0,0]},{base:base+900000,version:2,sha256:'b'.repeat(64),candleMasks:[32767,0,1<<7]}];
 const h=await runtime(async()=>Response.json({items}));
 assert.equal(await h.marketHistoryRuntime.candleFetchBoundary(base,base+200*60000,'SOL'),base+22*60000);
 assert.equal(await h.marketHistoryRuntime.candleFetchBoundary(base,base+200*60000,'ETH'),base+200*60000);
 assert.equal(await h.marketHistoryRuntime.candleFetchBoundary(base+60000,base+200*60000,'BTC'),base+60000);
});

test('download coverage never counts unsent local prices as cloud-saved after changing observation range',async()=>{
 const at=base+36000000;await storage.initStorage();await storage.setMeta('collector-term',f.term);await storage.save([],[{...candle,t:at}]);
 const remote={format:'MD-MARKET-MINUTE-1',base:at,rows:[{...emptyRow(at),cadence:60000,source:'browser',format:CONTRACT.datasetFormat}],candles:[]};
 const hash=await marketHash(remote),block={...remote,version:51,sha256:hash};await storage.applyMarketCloud(block as any,f);
 const head=(await storage.marketHistoryHead(at))!;await storage.marketHistoryMeta('market-history-read:'+at,{key:head.key,version:51},f);
 await storage.setMeta('market-history-pull',{hours:24,from:at,to:at+900000,cursor:50,items:[{base:at,version:51,sha256:hash}],initial:true});let reads=0;
 const h=await runtime(async input=>{if(String(input).includes('/index?'))return Response.json({items:[{base:at,version:51,sha256:hash}],total:1});reads++;return Response.json({block});});await h.pullWindow(f);
 assert.equal(h.marketHistoryRuntime.snapshot().download.coverage.assets[0].candles,0);
 assert.equal((await storage.marketHistoryContent(at)).candles.length,1,'the unique local candle must remain protected');
 assert.equal(reads,1,'unknown cloud coverage is read instead of inferred from merged local content');
 await storage.setMeta('market-history-pull',{hours:24,from:at,to:at+900000,cursor:50,items:[{base:at,version:51,sha256:hash}],initial:true,statsSource:'cloud-v2'});await h.pullWindow(f);
 assert.equal(h.marketHistoryRuntime.snapshot().download.coverage.assets[0].candles,0);assert.equal(reads,1,'a new view reuses only independently verified cloud coverage');
 await storage.setMeta('market-history-pull',{hours:24,from:at,to:at+900000,cursor:51,items:[],initial:false,stats:{[at]:{rows:1,assets:[{candles:1,depth300:0,depth750:0},{candles:0,depth300:0,depth750:0},{candles:0,depth300:0,depth750:0}],conflicts:0}}});await h.pullWindow(f);
 assert.equal(h.marketHistoryRuntime.snapshot().download.coverage.assets[0].candles,0,'legacy local-derived totals are invalidated and recounted');assert.equal(reads,1);
});
