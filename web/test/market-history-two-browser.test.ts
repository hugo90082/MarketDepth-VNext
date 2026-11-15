import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {runInNewContext} from 'node:vm';
import {readFile} from 'node:fs/promises';
import {IDBFactory,IDBKeyRange} from 'fake-indexeddb';
import {database,environment} from './helpers';
import {createSession,sessionCookie} from '../worker/auth';
import {marketHistoryApi,archiveMarketRailway} from '../worker/market-history';
import {CONTRACT,emptyRow} from '../shared/contract';
import {railwayReadbackHash} from '../shared/market-history';
import {sourceCode} from '../shared/market-sync';
const globals={Date,crypto,TextEncoder,TextDecoder,Blob,Response,CompressionStream,DecompressionStream,Uint8Array,ArrayBuffer,IDBKeyRange,setTimeout,AbortSignal};
async function browserStorage(){const b=await build({entryPoints:['src/storage.ts'],bundle:true,write:false,format:'cjs',platform:'node'}),module={exports:{} as any};runInNewContext(b.outputFiles[0].text,{...globals,module,exports:module.exports,indexedDB:new IDBFactory(),localStorage:{removeItem(){}}});const s=module.exports;await s.initStorage();await s.setMeta('collector-term',25);return s;}
async function browserRuntime(storage:any,fetcher:typeof fetch,hours:number){
 const mocks:Record<string,string>={
  '../storage':'export const {applyMarketCloud,marketHistoryMeta,marketHistoryHead,marketHistoryHeads,marketHistoryContent,getMeta,loadRows,initStorage,discoverMarketHistory,scanMarketHistory,historyTransferQueue,recordHistoryTransfer}=H.storage;',
  '../runtime/client':'export const marketRuntime={researchChannel:()=>({postMessage(){}}),collectorStamp:()=>({id:"test",epoch:25}),isCollector:()=>true,publish(){}};',
  '../local-maintenance':'export const localMaintenance={requestedHours:()=>H.hours};','../site-api':'export const AUTH_REQUIRED_EVENT="auth-required";',
 };
 const source=await readFile('src/market-history/runtime.ts','utf8'),b=await build({stdin:{contents:source+'\nexport {run,pullWindow};',resolveDir:process.cwd()+'/src/market-history',loader:'ts'},bundle:true,write:false,format:'cjs',platform:'node',define:{'import.meta.env.VITE_BFF_URL':'""'},plugins:[{name:'browser-boundary',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]}),module={exports:{} as any};
 runInNewContext(b.outputFiles[0].text,{...globals,module,exports:module.exports,H:{storage,hours},fetch:fetcher});return module.exports;
}
test('a designated browser uploads old+new history and an empty anonymous browser restores the actual public values',async()=>{
 const {db,raw}=database(),env=environment(db),client=crypto.randomUUID(),job=crypto.randomUUID(),session=await createSession(env),cookie=sessionCookie(new Request('https://site.test'),session).split(';')[0]+'; md_client='+client;
 const recent=Math.floor((Date.now()-3600000)/900000)*900000,old=recent-60*86400000,rows=[old,recent].map(t=>({...emptyRow(t),cadence:60000 as const,a:t+123,source:'railway' as const,format:CONTRACT.datasetFormat,finalVersion:7}));
 for(const r of rows)r.d=r.d.map(v=>v.map(a=>a.map(()=>[1234567.89123456,654321.12345678])));
 const seed=[{...rows[1],t:recent+60000}];raw.prepare('INSERT INTO md_jobs VALUES(?,?,?,?,?,?)').run(job,client,recent,recent+900000,Date.now()-1000,Date.now());raw.prepare('INSERT INTO md_chunks VALUES(?,?,?,?)').run('verified','a'.repeat(64),recent,JSON.stringify(seed));raw.prepare('INSERT INTO md_snapshots VALUES(?,?,?)').run('v3-collector',JSON.stringify({verified:true,unauthorized:false,indexVersion:7,index:[{id:'verified',sha256:'a'.repeat(64),startTsMs:recent,endTsMs:recent+900000}]}),Date.now());
 env.MARKET_HISTORY_PRIMARY_SOURCE=await sourceCode(client);let uploads=0;
 const fetcher=(authenticated:boolean):typeof fetch=>async(input,init={})=>{
  const path=String(input),headers=new Headers(init.headers);if(authenticated)headers.set('cookie',cookie);headers.set('origin','https://site.test');if(path.endsWith('/upload'))uploads++;
  return (await marketHistoryApi(new Request('https://site.test'+path,{...init,headers}),env))!;
 };
 const send=fetcher(true),first=await send('/api/market-history/qualification',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({phase:'begin',jobId:job})}),challenge=await first.json() as any;
 const confirmed=await send('/api/market-history/qualification',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({phase:'confirm',nonce:challenge.nonce,digest:await railwayReadbackHash(seed)})});assert.equal(confirmed.status,200);
 const donor=await browserStorage(),candles=rows.flatMap(r=>['BTC','ETH','SOL'].map(asset=>({asset,interval:60000,t:r.t,o:100,h:110,l:90,c:105.123456789,v:1.23456789,closed:true,complete:true,source:'binance-usdm'})));
 await donor.save(rows,candles);await donor.setMeta('market-history-discovered',true);const dr=await browserRuntime(donor,send,24);await dr.run();
 assert.equal(uploads,1);assert.equal(dr.marketHistoryRuntime.snapshot().pending,0);assert.equal(dr.marketHistoryRuntime.snapshot().scan.complete,true);assert.equal(dr.marketHistoryRuntime.snapshot().counts.valuesSaved,2);await dr.run();assert.equal(uploads,1);
 const receiver=await browserStorage(),rr=await browserRuntime(receiver,fetcher(false),2160);const fence={term:25,current:()=>true};
 for(let i=0;i<3;i++)if(!await rr.pullWindow(fence))break;
 const oldValues=await receiver.marketHistoryContent(old),newValues=await receiver.marketHistoryContent(recent);
 assert.equal(oldValues.candles.length,3);assert.equal(newValues.candles.length,3);assert.equal(oldValues.candles[0].c,105.123456789);assert.deepEqual(JSON.parse(JSON.stringify(oldValues.rows[0].d)),rows[0].d);assert.equal(oldValues.rows[0].source,'browser');assert.equal(oldValues.rows[0].finalVersion,undefined);
 assert.equal(rr.marketHistoryRuntime.snapshot().download.complete,true);assert.ok(rr.marketHistoryRuntime.snapshot().download.coverage.assets.every((a:any)=>a.candles===2));assert.ok(rr.marketHistoryRuntime.snapshot().download.expected>2);assert.equal(uploads,1);raw.close();
});

test('a real depth-only public archive lets an empty reader repair 200 price minutes per asset without fifteen-minute truncation',async()=>{
 const {db,raw}=database(),env=environment(db),at=Math.floor((Date.now()-86400000)/900000)*900000;
 const rows=Array.from({length:210},(_,i)=>({...emptyRow(at+i*60000),cadence:60000 as const,source:'railway' as const,format:CONTRACT.datasetFormat}));
 for(const r of rows)r.d=r.d.map(v=>v.map(a=>a.map(()=>[1234567.89,654321.12])));
 await archiveMarketRailway(env,rows,7);const reader=await browserStorage(),calls:string[]=[];
 const fetcher:typeof fetch=async(input,init={})=>{calls.push(String(input));return (await marketHistoryApi(new Request('https://site.test'+String(input),init),env))!;};
 const runtime=await browserRuntime(reader,fetcher,24),fence={term:25,current:()=>true};
 for(const asset of ['BTC','ETH','SOL']){
  await runtime.marketHistoryRuntime.beforeCandleFetch(at);
  assert.equal(await reader.firstMissingCandle(asset,at,at+210*60000),at);
  const end=await runtime.marketHistoryRuntime.candleFetchBoundary(at,at+210*60000,asset);
  assert.equal((end-at)/60000,200);
  // The exchange's exact 1m OHLCV response is persisted through the same browser store.
  await reader.save([],Array.from({length:(end-at)/60000},(_,i)=>({asset,interval:60000,t:at+i*60000,o:100,h:110,l:90,c:105.123456789,v:1.23456789,closed:true,complete:true,source:'binance-usdm'})),true,fence);
  assert.equal(await reader.firstMissingCandle(asset,at,at+210*60000),end);
  assert.equal((await reader.marketHistoryContent(at)).candles.filter((c:any)=>c.asset===asset).length,15);
 }
 assert.equal(calls.some(path=>path.endsWith('/upload')),false);
 assert.equal((await reader.marketHistoryContent(at)).rows.length,15);
 raw.close();
});
