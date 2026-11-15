import 'fake-indexeddb/auto';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {gunzipSync} from 'node:zlib';
import {ASSETS,VENUES,depth} from '../shared/model';
import {CONTRACT,emptyRow,type StoredRow,type StoredCandle} from '../shared/contract';
import {VIEW_ZONES} from '../shared/history-view';
import {exportDepth,LOCAL_EXPORT_FORMAT} from '../shared/local-history-export';
import {initStorage,save,setMeta,localHistoryExportBlocks,readLocalHistoryExportBlock,type LocalHistoryExportBlock} from '../src/storage';
import {streamHistoryExport,type ExportSource} from '../src/history-export/stream';
Object.defineProperty(globalThis,'localStorage',{value:{removeItem(){}}});
const base=Math.floor(1790350200000/900000)*900000;
function row(t=base):StoredRow{const r:StoredRow={...emptyRow(t),a:t+321,cadence:60000,source:'browser',format:CONTRACT.datasetFormat};r.d=r.d.map(v=>v.map(a=>a.map(()=>[1234567.891234567,234567.890123456])));return r;}
function candle(asset:StoredCandle['asset'],t=base):StoredCandle{return {asset,interval:60000,t,o:100,h:110,l:90,c:105.123456789,v:1.123456789,closed:true,complete:true,observedAt:t+61000,source:'binance-usdm'};}
async function capture(source:ExportSource,signal=new AbortController().signal){const chunks:Uint8Array[]=[],summary=await streamHistoryExport(source,new WritableStream({write(c){chunks.push(c);}}),Date.now(),signal,()=>{});return {summary,lines:new TextDecoder().decode(gunzipSync(Buffer.concat(chunks))).trimEnd().split('\n').map(s=>JSON.parse(s)),chunks};}
const local:ExportSource={list:localHistoryExportBlocks,read:readLocalHistoryExportBlock};
async function rawPut(value:unknown){const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('marketdepth-cache',5);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});const tx=db.transaction('blocks','readwrite');tx.objectStore('blocks').put(value);await new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);});db.close();}

test('all stored minute history round-trips OHLCV, raw depth, all 135 ratios, null/zero, provenance and gaps without private data',async()=>{
 await initStorage();
 const first=row(),second=row(base+120000),late=row(base+900000);first.source='railway';first.finalVersion=7;first.issues=['partial depth'];first.captured=VENUES.map(()=>ASSETS.map(()=>true));
 first.d[0][0][0]=[null,0];first.d[1][1][0]=[0,0];
 const active=candle('SOL',base+900000);active.closed=false;active.complete=false;delete active.source;
 await save([first,second,late],[...ASSETS.flatMap(a=>[candle(a),candle(a,base+120000)]),active]);
 await setMeta('session-secret','DO_NOT_EXPORT_COOKIE');await setMeta('upload-token','DO_NOT_EXPORT_TOKEN');await setMeta('alert-rules',{private:'DO_NOT_EXPORT_RULES'});
 const {summary,lines,chunks}=await capture(local),m=lines[0];
 assert.equal(m.format,LOCAL_EXPORT_FORMAT);assert.equal(m.cadenceMs,60000);assert.equal(m.blocks,6);assert.deepEqual(m.assets,ASSETS);assert.equal(m.ratioZoneIndices.length,9);assert.equal(lines.at(-1).complete,true);
 assert.equal(summary.depthRows,3);assert.equal(summary.candles,7);assert.equal(summary.assets.BTC.depth.missingMinutes,13);assert.equal(summary.assets.BTC.candles.missingMinutes,1);
 const exported=lines.filter(r=>r.type==='depth');for(const [i,r]of [first,second,late].entries()){
  const actual=exported[i];assert.deepEqual(actual.d,r.d);assert.equal(actual.a,r.a);assert.equal(actual.source,r.source);assert.equal(actual.finalVersion,r.finalVersion??null);
  for(const [vi,venue]of [...VENUES,'all4' as const].entries())for(const [ai,asset]of ASSETS.entries())for(const [zi,zones]of VIEW_ZONES.entries())assert.equal(actual.ratios[vi][ai][zi],depth(r,asset,venue,zones).ratio);
 }
 assert.equal(exported[0].ratios[0][0][0],null);assert.equal(exported[0].ratios[1][1][0],null);
 const prices=lines.filter(r=>r.type==='candle');assert.equal(prices[0].c,105.123456789);assert.equal(prices[0].v,1.123456789);assert.equal(prices.at(-1).closed,false);assert.equal(prices.at(-1).complete,false);assert.equal(prices.at(-1).source,null);
 assert.deepEqual(lines.filter(r=>r.type==='block').map(r=>r.id),await localHistoryExportBlocks());assert.ok(lines.filter(r=>r.type==='block').every(r=>r.revision>=1&&r.readAt>=base));
 assert.doesNotMatch(gunzipSync(Buffer.concat(chunks)).toString(),/DO_NOT_EXPORT|collector-term|market-history-dirty|recoverableRevision/);
});

test('partial coverage uses the same formal calculation and quality is whitelisted without rounding',()=>{
 const r=row();r.d[0][0][0]=[100.123456789,50.987654321];r.d[0][0][1]=[null,null];
 r.quality={version:'FORMAL_AVAILABLE_V2',books:VENUES.map(()=>ASSETS.map(()=>null))};
 r.quality.books[0][0]={capturedAt:base+123,feed:'diff',mode:'ready',bidBps:80,askBps:80,complete:[false,false,false,false,false],lastMessageAt:base+234,snapshotAt:base-1,observedBidBps:800,observedAskBps:800,coverageMode:'sequenced-diff',privateToken:'DO_NOT_EXPORT'} as any;
 const out=exportDepth(r);assert.equal(out.ratios[0][0][5],(100.123456789-50.987654321)/(100.123456789+50.987654321));assert.equal(out.quality!.books[0][0]!.lastMessageAt,base+234);assert.doesNotMatch(JSON.stringify(out),/DO_NOT_EXPORT/);
 delete r.quality;assert.equal(exportDepth(r).quality,null);
});

test('per-block reads record the new actual revision while concurrent writes keep running',async()=>{
 const ids=await localHistoryExportBlocks(),id=ids.find(k=>k.startsWith('row:'))!,before=await readLocalHistoryExportBlock(id);let updated=false;
 const output=await capture({list:async()=>[id],read:async key=>{const r=row();r.source='railway';r.finalVersion=8;r.d[0][0][0]=[null,null];await save([r]);updated=true;return readLocalHistoryExportBlock(key);}});
 assert.ok(updated);assert.ok(output.lines[1].revision>before.revision);assert.equal(output.lines.find(r=>r.type==='depth').finalVersion,8);assert.deepEqual(output.lines.find(r=>r.type==='depth').d[0][0][0],[null,null]);
});

test('empty local history and disk write failures never return a completed export',async()=>{
 await assert.rejects(capture({list:async()=>[],read:async()=>{throw Error('must not read');}}),/尚無/);
 await assert.rejects(streamHistoryExport(local,new WritableStream({write(){throw new Error('DISK_FULL');}}),Date.now(),new AbortController().signal,()=>{}),/DISK_FULL/);
});

test('cancellation aborts compressed output and stops the block reader',async()=>{
 const controller=new AbortController();let reads=0,aborted=false;
 const source:ExportSource={list:async()=>['one','two'],read:async()=>{reads++;return {id:'one',base,revision:1,readAt:Date.now(),rows:[row()],candles:[]};}};
 await assert.rejects(streamHistoryExport(source,new WritableStream({abort(){aborted=true;}}),Date.now(),controller.signal,p=>{if(p.blocks===1)controller.abort(new DOMException('cancel','AbortError'));}),{name:'AbortError'});
 assert.equal(reads,1);assert.ok(aborted);
});

test('large history is read incrementally with bounded blocks and output backpressure',async()=>{
 const count=1200;let reads=0,writes=0,lastRead=0;
 const source:ExportSource={list:async()=>Array.from({length:count},(_,i)=>String(i)),read:async id=>{reads++;const b=base+Number(id)*900000;return {id,base:b,revision:1,readAt:Date.now(),rows:[row(b)],candles:[]};}};
 const result=await streamHistoryExport(source,new WritableStream({async write(c){assert.ok(c.byteLength<=65536);writes++;assert.ok(reads>=lastRead);lastRead=reads;await new Promise(resolve=>setImmediate(resolve));}}),base+count*900000,new AbortController().signal,()=>{});
 assert.equal(result.depthRows,count);assert.equal(result.blocks,count);assert.ok(writes>5);assert.equal(reads,count);
});

test('a corrupt or missing block fails explicitly; chart-style silent recovery is not used',async()=>{
 await assert.rejects(readLocalHistoryExportBlock('row:0'),/遺失或損壞/);
 const id='row:900000';await rawPut({id,base:900000,revision:1,bytes:4,gzip:new Uint8Array([1,2,3])});
 assert.ok((await localHistoryExportBlocks()).includes(id));await assert.rejects(capture(local),/遺失或損壞/);
 await rawPut({id,base:900000,revision:2,bytes:1,raw:[[0,900000,row().d,0,null,null,{bad:true},60000]]});await assert.rejects(readLocalHistoryExportBlock(id),/遺失或損壞/);
});
