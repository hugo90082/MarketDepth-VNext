import { CONTRACT, WINDOW, mergeSpans, type Span, type StoredCandle, type StoredRow } from '../shared/contract';
import {ASSETS,validateRow,type Asset} from '../shared/model';
import {validCandle} from '../shared/chart-data';
import {blockSignature,type VerifiedBlock,type VerifiedChunk} from './history-quality';
import {minuteRows,minuteCandles} from '../shared/minute-history';
import {cleanupPlan,removable,type ManagedVersion} from '../shared/managed-storage';
import {DepthViewAccumulator,CandleViewAccumulator,type DepthViewSelection} from '../shared/history-view';
import type {Interval} from '../shared/contract';
import {marketContent,marketHash,emptyMarketBlock,mergeMarketContent,type MarketBlock} from '../shared/market-history';
import type {OfferOutcome} from '../shared/market-sync';

const NAME='marketdepth-cache',BLOCK=900000;
let opening:Promise<IDBDatabase>|undefined;
const encoder=new TextEncoder(),decoder=new TextDecoder();
const damaged=new Set<string>();
const marketBlockListeners=new Set<(base:number)=>void>();
export function onMarketBlockSaved(listener:(base:number)=>void){
 marketBlockListeners.add(listener);
 return ()=>{marketBlockListeners.delete(listener);};
}
export const storageNotice=()=>damaged.size?`${damaged.size} 個快取區塊含無效資料，已略過；可由歷史重新補齊`:'';
type BlockRecord={id:string;base:number;revision:number;bytes:number;raw?:any[][];gzip?:Uint8Array;recoverableRevision?:number;marketCloudRevision?:number;recoverabilityCheckedRevision?:number;recoverabilityCheckedProof?:string;pinned?:boolean;pending?:boolean};
type Manifest=ManagedVersion&{base:number;completeMask?:number};
const manifest=(b:BlockRecord,tuples?:any[][]):Manifest=>({id:b.id,base:b.base,at:b.base,bytes:b.bytes,revision:b.revision,recoverableRevision:b.recoverableRevision,marketCloudRevision:b.marketCloudRevision,pinned:b.pinned,pending:b.pending,...(b.id.startsWith('candle:')&&tuples?{completeMask:tuples.reduce((mask,t)=>t[6]&&t[7]?mask|(1<<Math.floor(t[0]/60000)):mask,0)}:{})});
export type CollectorFence={term:number;current:()=>boolean;fromCloud?:boolean};
const blockId=(kind:'row'|'candle',base:number,asset?:Asset,interval?:number)=>kind==='row'?`row:${base}`:`candle:${asset}:${interval}:${base}`;
function request<T>(r:IDBRequest<T>):Promise<T>{return new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
function done(tx:IDBTransaction){return new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error??new Error('儲存交易中斷'));tx.onerror=()=>reject(tx.error);});}
async function open(){
 if(!opening)opening=new Promise<IDBDatabase>((resolve,reject)=>{
  const r=indexedDB.open(NAME,5);
  r.onblocked=()=>reject(new Error('請關閉舊版網站分頁，再重新整理以更新快取'));
  r.onerror=()=>reject(r.error);
  r.onupgradeneeded=event=>{
   const db=r.result;
   if(!db.objectStoreNames.contains('rows'))db.createObjectStore('rows',{keyPath:'t'});
   if(!db.objectStoreNames.contains('candles')){const candles=db.createObjectStore('candles',{keyPath:['asset','interval','t']});candles.createIndex('time','t');}
   if(!db.objectStoreNames.contains('meta'))db.createObjectStore('meta');
   if(!db.objectStoreNames.contains('blocks')){const blocks=db.createObjectStore('blocks',{keyPath:'id'});blocks.createIndex('base','base');}
   if(!db.objectStoreNames.contains('ledger')){const ledger=db.createObjectStore('ledger',{keyPath:'id'});ledger.createIndex('base','base');}
  };
  r.onsuccess=()=>{const db=r.result;db.onversionchange=()=>{db.close();opening=undefined;};resolve(db);};
 });
 return opening;
}
async function unpack(record:BlockRecord|undefined):Promise<any[][]>{
 if(!record)return [];
 if(record.raw){if(!Array.isArray(record.raw))throw new Error('INVALID_CACHE_BLOCK');return record.raw;}
 if(!record.gzip)return [];
 const stream=new Blob([new Uint8Array(record.gzip)]).stream().pipeThrough(new DecompressionStream('gzip'));
 const data=JSON.parse(decoder.decode(await new Response(stream).arrayBuffer()));if(!Array.isArray(data))throw new Error('INVALID_CACHE_BLOCK');return data;
}
async function pack(rows:any[][],closed:boolean){
 const data=encoder.encode(JSON.stringify(rows));
 if(!closed)return {raw:rows,bytes:data.byteLength};
 const stream=new Blob([data]).stream().pipeThrough(new CompressionStream('gzip'));
 const gzip=new Uint8Array(await new Response(stream).arrayBuffer());
 return {gzip,bytes:gzip.byteLength};
}
const rowTuple=(r:StoredRow,base:number)=>[r.t-base,r.a,r.d,r.source==='railway'?1:r.source==='recent'?2:0,r.captured?r.captured.flat().reduce((bits,v,i)=>bits+(v?2**i:0),0):null,r.issues??null,r.quality??null,r.cadence??null,r.finalVersion??null];
function validQuality(q:any):q is NonNullable<StoredRow['quality']>{return (q?.version==='FORMAL_AVAILABLE_V1'||q?.version==='FORMAL_AVAILABLE_V2')&&Array.isArray(q.books)&&q.books.length===4&&q.books.every((v:any)=>Array.isArray(v)&&v.length===3&&v.every((b:any)=>b===null||Number.isSafeInteger(b?.capturedAt)&&typeof b.feed==='string'&&typeof b.mode==='string'&&Number.isFinite(b.bidBps)&&b.bidBps>=0&&Number.isFinite(b.askBps)&&b.askBps>=0&&Array.isArray(b.complete)&&b.complete.length===5&&b.complete.every((c:any)=>typeof c==='boolean')));}
const rowFrom=(tuple:any[],base:number):StoredRow=>{
 const captured=tuple[4]===null?undefined:Array.from({length:4},(_,v)=>Array.from({length:3},(_,a)=>!!(tuple[4]&(1<<(v*3+a)))));
 // Old builds encoded unsealed Recent as 1, the same code as sealed History.
 // A Recent merge retained the local browser capture bitmap; sealed chunks did
 // not. Recover that provenance without deleting or re-downloading the cache.
 const source=tuple[3]===2||tuple[3]===1&&captured&&tuple[8]==null?'recent':tuple[3]===1?'railway':'browser';
 return {t:base+tuple[0],a:tuple[1],d:tuple[2],source,format:CONTRACT.datasetFormat,...(tuple[7]===60000?{cadence:60000 as const}:{}),...(Number.isSafeInteger(tuple[8])&&tuple[8]>=0?{finalVersion:tuple[8]}:{}),...(captured?{captured}:{}),...(Array.isArray(tuple[5])?{issues:tuple[5].filter(x=>typeof x==='string')}:{}) ,...(validQuality(tuple[6])?{quality:tuple[6]}:{})};
};
const candleTuple=(c:StoredCandle,base:number)=>[c.t-base,c.o,c.h,c.l,c.c,c.v,c.closed?1:0,c.complete?1:0,c.observedAt??null,c.source??null];
const candleFrom=(tuple:any[],base:number,asset:Asset,interval:30000|60000):StoredCandle=>({asset,interval,t:base+tuple[0],o:tuple[1],h:tuple[2],l:tuple[3],c:tuple[4],v:tuple[5],closed:!!tuple[6],complete:!!tuple[7],...(tuple[8]==null?{}:{observedAt:tuple[8]}),...(['binance-usdm','legacy-30s','import'].includes(tuple[9])?{source:tuple[9]}:{})});
async function block(id:string){const db=await open();return request<BlockRecord|undefined>(db.transaction('blocks').objectStore('blocks').get(id));}
async function putBlock(id:string,base:number,tuples:any[][],merge:(old:any[],next:any[])=>any[],attempt=0,fence?:CollectorFence):Promise<void>{
 if(!tuples.length)return;
 const old=await block(id),existing=await unpack(old),map=new Map<number,any[]>(existing.map(t=>[t[0],t]));
 for(const tuple of tuples)map.set(tuple[0],map.has(tuple[0])?merge(map.get(tuple[0])!,tuple):tuple);
 const encoded=await pack([...map.values()].sort((a,b)=>a[0]-b[0]),Date.now()>base+BLOCK);
 const db=await open(),tx=db.transaction(['blocks','meta','ledger'],'readwrite'),finished=done(tx);void finished.catch(()=>{});
 try{
  if(fence&&(!fence.current()||await request<number>(tx.objectStore('meta').get('collector-term'))!==fence.term)){tx.abort();throw new Error('STALE_COLLECTOR_WRITE');}
  const store=tx.objectStore('blocks'),current=await request<BlockRecord|undefined>(store.get(id));
  if(fence&&!fence.current()){tx.abort();throw new Error('STALE_COLLECTOR_WRITE');}
  if((current?.revision??0)!==(old?.revision??0)){tx.abort();await finished.catch(()=>{});if(attempt>=8)throw new Error('儲存寫入衝突');return putBlock(id,base,tuples,merge,attempt+1,fence);}
  const revision=(old?.revision??0)+1;
  const replayable=id.startsWith('candle:')&&[...map.values()].every(t=>t[6]&&t[7]&&t[9]==='binance-usdm');
  const next={id,base,revision,bytes:encoded.bytes,pinned:current?.pinned,...(id.startsWith('candle:')?{recoverabilityCheckedRevision:revision}:{}),...(replayable?{recoverableRevision:revision}:{}),...(encoded.raw?{raw:encoded.raw}:{gzip:encoded.gzip})};store.put(next);tx.objectStore('ledger').put(manifest(next,[...map.values()]));
  const meta=tx.objectStore('meta'),bytes=Number(await request(meta.get('bytes'))??0)+encoded.bytes-(old?.bytes??0);
  if(fence&&!fence.current()){tx.abort();throw new Error('STALE_COLLECTOR_WRITE');}
  meta.put(bytes,'bytes');if(!fence?.fromCloud)meta.put(true,'market-history-dirty:'+base);await finished;
  for(const listener of marketBlockListeners)queueMicrotask(()=>listener(base));
 }catch(e){await finished.catch(()=>{});throw e;}
}
const mergeRow=(old:any[],next:any[])=>{
 const previous=old[3]===1&&old[4]!==null&&old[8]==null?2:old[3];
 if(previous===1&&next[3]===1&&(old[8]??-1)>(next[8]??-1))return old;
 return previous===1&&next[3]!==1||previous===2&&next[3]===0?old:next;
};
const mergeCandle=(old:any[],next:any[])=>old[6]&&old[7]&&(!next[6]||!next[7])?old:next;
async function writeRows(rows:StoredRow[],fence?:CollectorFence){const groups=new Map<number,any[][]>();for(const row of rows){if(row.format!==CONTRACT.datasetFormat)continue;const base=Math.floor(row.t/BLOCK)*BLOCK;groups.set(base,[...groups.get(base)??[],rowTuple(row,base)]);}for(const [base,tuples]of groups)await putBlock(blockId('row',base),base,tuples,mergeRow,0,fence);}
async function writeCandles(candles:StoredCandle[],fence?:CollectorFence){const groups=new Map<string,{base:number;tuples:any[][]}>();for(const c of candles){const base=Math.floor(c.t/BLOCK)*BLOCK,id=blockId('candle',base,c.asset,c.interval);const group=groups.get(id)??{base,tuples:[]};group.tuples.push(candleTuple(c,base));groups.set(id,group);}for(const [id,{base,tuples}]of groups)await putBlock(id,base,tuples,mergeCandle,0,fence);}
async function migrateStore(name:'rows'|'candles'){
 const db=await open(),store=db.transaction(name).objectStore(name),batch=await request<any[]>(store.getAll(undefined,50));
 if(!batch.length)return false;
 if(name==='rows')await writeRows(batch as StoredRow[]);else await writeCandles(batch as StoredCandle[]);
 for(const value of batch){
  const actual=name==='rows'?(await loadRows(value.t,value.t))[0]:(await loadCandles(value.asset,value.t,value.t)).find(c=>c.interval===value.interval);
  const keys=name==='rows'?['t','a','d','source','format','captured','issues']:['asset','interval','t','o','h','l','c','v','closed','complete','observedAt'];
  const sourceChanged=name==='rows'&&((value.source==='browser'&&(actual as StoredRow|undefined)?.source==='railway')||(value.source==='railway'&&value.captured&&(actual as StoredRow|undefined)?.source==='recent'));
  if(!actual||keys.some(key=>key!=='source'||!sourceChanged?JSON.stringify((actual as any)[key])!==JSON.stringify(value[key]):false))throw new Error('快取遷移驗證失敗');
 }
 const tx=db.transaction(name,'readwrite'),finished=done(tx);for(const value of batch)tx.objectStore(name).delete(name==='rows'?value.t:[value.asset,value.interval,value.t]);await finished;
 return true;
}
async function migrate(){
 if(await getMeta<boolean>('blocksMigrated'))return;
 while(await migrateStore('rows')){}while(await migrateStore('candles')){}
 const db=await open(),tx=db.transaction('blocks'),cursor=tx.objectStore('blocks').openCursor();let bytes=0;
 await new Promise<void>((resolve,reject)=>{cursor.onsuccess=()=>{const item=cursor.result;if(!item){resolve();return;}bytes+=(item.value as BlockRecord).bytes;item.continue();};cursor.onerror=()=>reject(cursor.error);});
 await setMeta('bytes',bytes);
 await setMeta('blocksMigrated',true);
}
export async function initStorage(){
 const db=await open(),tx=db.transaction(['rows','candles','blocks','meta','ledger'],'readwrite'),finished=done(tx),meta=tx.objectStore('meta');
 const format=await request(meta.get('format'));if(format!==CONTRACT.datasetFormat){const count=(await request(tx.objectStore('rows').count()))+(await request(tx.objectStore('candles').count()))+(await request(tx.objectStore('blocks').count()));if(count){await finished;throw new Error('舊快取格式尚未支援轉換；原資料已保留，未清空。');}meta.put(0,'bytes');meta.put(CONTRACT.datasetFormat,'format');}
 await finished;await migrate();await migrateMinutes();await repairLedger();
 for(const key of Object.keys(localStorage))if(/^marketdepth[:.-](depth|history|index|cache)/i.test(key))localStorage.removeItem(key);
}
async function safeUnpack(id:string){try{return await unpack(await block(id));}catch{damaged.add(id);return [];}}
export async function loadRows(from:number,to:number):Promise<StoredRow[]>{const out=new Map<number,StoredRow>();for(let base=Math.floor(from/BLOCK)*BLOCK;base<=to;base+=BLOCK){const id=blockId('row',base);for(const tuple of await safeUnpack(id)){try{const row=rowFrom(tuple,base);validateRow(row);if(row.t>=from&&row.t<=to&&row.t>=base&&row.t<base+BLOCK)out.set(row.t,row);}catch{damaged.add(id);}}}return [...out.values()].sort((a,b)=>a.t-b.t);}
export async function loadCandles(asset:Asset,from:number,to:number):Promise<StoredCandle[]>{const out=new Map<string,StoredCandle>();for(let base=Math.floor(from/BLOCK)*BLOCK;base<=to;base+=BLOCK)for(const interval of [30000,60000] as const){const id=blockId('candle',base,asset,interval);for(const tuple of await safeUnpack(id)){try{const c=candleFrom(tuple,base,asset,interval);if(!validCandle(c)||c.t%interval||c.t<base||c.t>=base+BLOCK)throw new Error('INVALID_CANDLE');if(c.t>=from&&c.t<=to)out.set(interval+':'+c.t,c);}catch{damaged.add(id);}}}return [...out.values()].sort((a,b)=>a.t-b.t);}
/** Export reads actual blocks, never display aggregates or private meta/queues.
 * Unlike chart recovery, corrupt data must fail rather than silently disappear. */
export async function localHistoryExportBlocks():Promise<string[]>{
 const db=await open(),tx=db.transaction(['blocks','rows','candles','meta']),finished=done(tx);
 const [keys,rows,candles,version]=await Promise.all([request<IDBValidKey[]>(tx.objectStore('blocks').getAllKeys()),request(tx.objectStore('rows').count()),request(tx.objectStore('candles').count()),request(tx.objectStore('meta').get('minuteMigrationVersion'))]);await finished;
 if(rows||candles||keys.length&&version!==1||keys.some(k=>/^candle:(BTC|ETH|SOL):30000:/.test(String(k))))throw new Error('分鐘資料轉換尚未完成，請稍後再匯出；原資料已保留。');
 return keys.map(String).filter(id=>/^row:\d+$|^candle:(BTC|ETH|SOL):60000:\d+$/.test(id)).sort((a,b)=>Number(a.split(':').at(-1))-Number(b.split(':').at(-1))||a.localeCompare(b));
}
export type LocalHistoryExportBlock={id:string;base:number;revision:number;readAt:number;rows:StoredRow[];candles:StoredCandle[]};
export async function readLocalHistoryExportBlock(id:string):Promise<LocalHistoryExportBlock>{
 const db=await open(),tx=db.transaction('blocks'),finished=done(tx),record=await request<BlockRecord|undefined>(tx.objectStore('blocks').get(id));await finished;
 try{
  if(!record||record.id!==id||!Number.isSafeInteger(record.base)||record.base%BLOCK||Number(id.split(':').at(-1))!==record.base||!Number.isSafeInteger(record.revision)||record.revision<1||(!record.raw&&!record.gzip))throw new Error('INVALID_BLOCK');
  const readAt=Date.now(),tuples=await unpack(record),rows:StoredRow[]=[],candles:StoredCandle[]=[];let prior=-1;
  for(const tuple of tuples){
   if(!Array.isArray(tuple)||!Number.isSafeInteger(tuple[0])||tuple[0]<0||tuple[0]>=BLOCK||tuple[0]%60000||tuple[0]<=prior)throw new Error('INVALID_MINUTE');prior=tuple[0];
   if(id.startsWith('row:')){
    if(![0,1,2].includes(tuple[3])||tuple[7]!==60000||tuple[4]!=null&&(!Number.isInteger(tuple[4])||tuple[4]<0||tuple[4]>4095)||tuple[5]!=null&&(!Array.isArray(tuple[5])||!tuple[5].every((x:unknown)=>typeof x==='string'))||tuple[6]!=null&&!validQuality(tuple[6])||tuple[8]!=null&&(!Number.isSafeInteger(tuple[8])||tuple[8]<0))throw new Error('INVALID_DEPTH');
    const row=rowFrom(tuple,record.base);validateRow(row);rows.push(row);
   }else{
    const match=id.match(/^candle:(BTC|ETH|SOL):60000:\d+$/);if(!match||![0,1].includes(tuple[6])||![0,1].includes(tuple[7])||tuple[8]!=null&&(!Number.isSafeInteger(tuple[8])||tuple[8]<0)||tuple[9]!=null&&!['binance-usdm','legacy-30s','import'].includes(tuple[9]))throw new Error('INVALID_CANDLE');
    const candle=candleFrom(tuple,record.base,match[1] as Asset,60000);if(!validCandle(candle))throw new Error('INVALID_CANDLE');candles.push(candle);
   }
  }
  return {id,base:record.base,revision:record.revision,readAt,rows,candles};
 }catch{throw new Error(`歷史區塊 ${id} 遺失或損壞，匯出已停止；本機資料未修改。`);}
}
export async function getMeta<T>(key:string):Promise<T|undefined>{const db=await open();return request(db.transaction('meta').objectStore('meta').get(key));}
export async function setMeta(key:string,value:unknown){const db=await open(),tx=db.transaction('meta','readwrite'),finished=done(tx);tx.objectStore('meta').put(value,key);await finished;}
export async function confirm(spans:Span[]){const db=await open(),tx=db.transaction('meta','readwrite'),finished=done(tx),m=tx.objectStore('meta');const old=await request<Span[]|undefined>(m.get('confirmed'));m.put(mergeSpans([...(old??[]),...spans]),'confirmed');await finished;}
export async function verifiedChunks(){return await getMeta<VerifiedChunk[]>('verifiedChunks')??[];}
export async function verifiedBlocks(){return await getMeta<VerifiedBlock[]>('verifiedBlocks')??[];}
export async function saveVerifiedChunks(chunks:VerifiedChunk[]){
 if(!chunks.length)return;
 const db=await open(),tx=db.transaction('meta','readwrite'),finished=done(tx),meta=tx.objectStore('meta');
 const old=await request<VerifiedChunk[]|undefined>(meta.get('verifiedChunks'))??[];
 const map=new Map(old.map(c=>[c.id+':'+c.sha256,c]));
 for(const chunk of chunks)map.set(chunk.id+':'+chunk.sha256,chunk);
 meta.put([...map.values()],'verifiedChunks');await finished;
}
export async function saveVerifiedBlocks(blocks:VerifiedBlock[]){
 if(!blocks.length)return;
 const db=await open(),tx=db.transaction('meta','readwrite'),finished=done(tx),meta=tx.objectStore('meta');
 const old=await request<VerifiedBlock[]|undefined>(meta.get('verifiedBlocks'))??[];
 const map=new Map(old.map(b=>[b.base,b]));
 for(const block of blocks){const prior=map.get(block.base),same=prior?.signature===block.signature;
  map.set(block.base,{...block,confirmedMask:block.confirmedMask|(same?prior.confirmedMask:0),presentMask:block.presentMask|(same?prior.presentMask:0)});}
 meta.put([...map.values()].sort((a,b)=>a.base-b.base),'verifiedBlocks');await finished;
}
export async function locallyHeldChunkKeys(from:number,to:number){
 const chunks=(await verifiedChunks()).filter(c=>c.endTsMs>from&&c.startTsMs<to).sort((a,b)=>a.startTsMs-b.startTsMs);
 if(!chunks.length)return new Set<string>();
 const held=new Set<string>();let i=0;
 while(i<chunks.length){const start=chunks[i].startTsMs,batch:VerifiedChunk[]=[];while(i<chunks.length&&chunks[i].endTsMs<=start+8*BLOCK)batch.push(chunks[i++]);if(!batch.length)batch.push(chunks[i++]);
  const rows=new Map((await loadRows(start,Math.max(...batch.map(c=>c.endTsMs))-1)).map(r=>[r.t,r]));for(const c of batch)if(c.rowTimes.every(t=>(rows.get(t)??rows.get(Math.floor(t/60000)*60000))?.source==='railway'))held.add(c.id+':'+c.sha256);
 }return held;
}
export async function save(rows:StoredRow[]=[],candles:StoredCandle[]=[],retry=true,fence?:CollectorFence){
 rows=rows.filter(r=>{try{return r.format===CONTRACT.datasetFormat&&!!validateRow(r);}catch{return false;}});
 candles=candles.filter(c=>ASSETS.includes(c.asset)&&[30000,60000].includes(c.interval)&&c.t%c.interval===0&&validCandle(c));
 try{await writeRows(minuteRows(rows),fence);await writeCandles(minuteCandles(candles),fence);}
 catch(e){if((e as DOMException)?.name==='QuotaExceededError'){await setMeta('quotaBlocked',true);throw new Error('瀏覽器配額不足；唯一資料保留，已暫停可重建的歷史回補')};throw e;}
}
export async function managedBlocks():Promise<ManagedVersion[]>{const db=await open(),records=await request<Manifest[]>(db.transaction('ledger').objectStore('ledger').getAll()),pending=new Set((await request<IDBValidKey[]>(db.transaction('meta').objectStore('meta').getAllKeys())).filter(k=>String(k).startsWith('market-history-dirty:')).map(k=>Number(String(k).split(':')[1])));return records.map(r=>({...r,pending:r.pending||pending.has(r.base),id:'history:'+r.id,bytes:r.bytes+encoder.encode(JSON.stringify(r)).byteLength}));}
export async function managedMetadataBytes(){const db=await open();let bytes=0;for(const name of ['meta','rows','candles'])await new Promise<void>((resolve,reject)=>{const r=db.transaction(name).objectStore(name).openCursor();r.onerror=()=>reject(r.error);r.onsuccess=()=>{const c=r.result;if(!c){resolve();return;}bytes+=encoder.encode(JSON.stringify([c.key,c.value])).length;c.continue();};});return bytes;}
export async function retireProtection(current=()=>true){
 const db=await open(),tx=db.transaction(['blocks','ledger','meta'],'readwrite'),finished=done(tx);void finished.catch(()=>{});
 // Keep the existing completeMask: compressed blocks have no raw tuples here.
 for(const name of ['blocks','ledger']){
  const cursor=tx.objectStore(name).openCursor();cursor.onsuccess=()=>{if(!current()){tx.abort();return;}const c=cursor.result;if(!c)return;const b=c.value;for(const key of ['cloudRevision','backupRevision','recoverableRevision','recoverabilityCheckedRevision','recoverabilityCheckedProof','pinned','pending'])delete b[key];c.update(b);c.continue();};
 }
 const m=tx.objectStore('meta'),keys=m.openCursor();keys.onsuccess=()=>{if(!current()){tx.abort();return;}const c=keys.result;if(!c)return;if(/^(?:upload-|cloud-|offered:|offered-liquidation|sync-job$|view-job$|collector$|cleanup$)/.test(String(c.key)))c.delete();c.continue();};await finished;
}
export async function refreshRecoverability(current=()=>true){
 const db=await open(),proofs=new Map((await verifiedBlocks()).map(p=>[p.base,p])),chunks=(await verifiedChunks()).map(c=>({...c,cached:true}));let budget=100;
 const headers=(await request<Manifest[]>(db.transaction('ledger').objectStore('ledger').getAll())).sort((a,b)=>a.base-b.base);
 for(const header of headers){if(!current()||budget<=0)return;const b=await block(header.id);if(!b)continue;
  const p=proofs.get(b.base),signature=blockSignature(chunks,b.base),proof=b.id.startsWith('candle:')?undefined:JSON.stringify([p?.signature,p?.indexVersion,p?.confirmedMask,signature]);
  if(b.recoverabilityCheckedRevision===b.revision&&b.recoverabilityCheckedProof===proof)continue;
  budget--;let tuples:any[][];try{tuples=await unpack(b);}catch{damaged.add(b.id);continue;}
  const recoverable=tuples.length>0&&(b.id.startsWith('candle:')?tuples.every(t=>t[6]&&t[7]&&t[9]==='binance-usdm'):!!p&&p.indexVersion!==null&&p.signature===signature&&tuples.every(t=>{const mask=3<<Math.floor(t[0]/60000)*2;return t[3]===1&&t[8]===p.indexVersion&&(p.confirmedMask&mask)===mask;}));
  if(!current())return;const tx=db.transaction(['blocks','ledger'],'readwrite'),finished=done(tx),s=tx.objectStore('blocks'),latest=await request<BlockRecord|undefined>(s.get(b.id));if(current()&&latest?.revision===b.revision){const next={...latest,recoverabilityCheckedRevision:b.revision,recoverabilityCheckedProof:proof,recoverableRevision:recoverable?b.revision:undefined};s.put(next);tx.objectStore('ledger').put(manifest(next,tuples));}await finished;
 }
}
export async function removeManagedBlock(id:string,revision:number){const db=await open(),tx=db.transaction(['blocks','meta','ledger'],'readwrite'),finished=done(tx),s=tx.objectStore('blocks'),b=await request<BlockRecord|undefined>(s.get(id));let removed=false;if(b?.revision===revision&&!await request(tx.objectStore('meta').get('market-history-dirty:'+b.base))&&removable({...b,at:b.base})){s.delete(id);tx.objectStore('ledger').delete(id);const m=tx.objectStore('meta');m.put(Math.max(0,Number(await request(m.get('bytes'))??0)-b.bytes),'bytes');m.put(true,'evicted');removed=true;}await finished;return removed;}
/** Revisions are checked in the same transaction that replaces each block.
 * Interruption leaves either the original block or the verified minute block. */
async function migrateMinutes(){
 const db=await open(),ids=await request<IDBValidKey[]>(db.transaction('blocks').objectStore('blocks').getAllKeys());
 for(const id of ids){const before=await block(String(id));if(!before)continue;
  if(String(id).startsWith('row:')){
   let tuples:any[][];try{tuples=await unpack(before);for(const t of tuples)validateRow(rowFrom(t,before.base));}catch{damaged.add(String(id));continue;}if(tuples.every(t=>t[7]===60000))continue;
   const rows=minuteRows(tuples.map(t=>rowFrom(t,before.base))),encoded=await pack(rows.map(r=>rowTuple(r,before.base)),true);
   const candidate={id:before.id,base:before.base,revision:before.revision,...encoded};if(canonicalRows(await unpack(candidate))!==canonicalRows(rows.map(r=>rowTuple(r,before.base))))throw new Error('分鐘遷移核對失敗');
   const tx=db.transaction(['blocks','meta','ledger'],'readwrite'),finished=done(tx),store=tx.objectStore('blocks'),current=await request<BlockRecord|undefined>(store.get(id));
   if(current?.revision!==before.revision){await finished;continue;}
   const next={id:before.id,base:before.base,revision:before.revision+1,...encoded};store.put(next);tx.objectStore('ledger').put(manifest(next));const meta=tx.objectStore('meta'),bytes=Number(await request(meta.get('bytes'))??0);meta.put(bytes+encoded.bytes-before.bytes,'bytes');await finished;
  }else{const match=String(id).match(/^candle:(BTC|ETH|SOL):30000:(\d+)$/);if(!match)continue;
   const asset=match[1] as Asset,existing=await loadCandles(asset,before.base,before.base+BLOCK-1),converted=minuteCandles([...((await unpack(before)).map(t=>candleFrom(t,before.base,asset,30000))),...existing.filter(c=>c.interval===60000)]);await writeCandles(converted);
   const actual=await loadCandles(asset,before.base,before.base+BLOCK-1);if(converted.some(c=>!actual.some(a=>a.interval===60000&&['asset','interval','t','o','h','l','c','v','closed','complete','observedAt','source'].every(k=>(a as any)[k]===(c as any)[k]))))throw new Error('K 線分鐘遷移核對失敗');
   const tx=db.transaction(['blocks','meta','ledger'],'readwrite'),finished=done(tx),store=tx.objectStore('blocks'),current=await request<BlockRecord|undefined>(store.get(id));if(current?.revision!==before.revision){await finished;continue;}
   const meta=tx.objectStore('meta');meta.put({at:Date.now(),converted:converted.length,missing:30-converted.length*2},'minute-migration:'+id);store.delete(id);tx.objectStore('ledger').delete(id);meta.put(Math.max(0,Number(await request(meta.get('bytes'))??0)-before.bytes),'bytes');await finished;
  }
  await new Promise(resolve=>setTimeout(resolve,0));
 }
 await setMeta('minuteMigrationVersion',1);
}
const canonicalRows=(x:unknown)=>JSON.stringify(x);
export async function lease(owner:string,now:number){const db=await open(),tx=db.transaction('meta','readwrite'),finished=done(tx),m=tx.objectStore('meta');const old=await request<{owner:string;until:number}|undefined>(m.get('leader'));const win=!old||old.until<=now||old.owner===owner;if(win)m.put({owner,until:now+15000},'leader');await finished;return win;}
export async function releaseLease(owner:string){const db=await open(),tx=db.transaction('meta','readwrite'),finished=done(tx),m=tx.objectStore('meta');const old=await request<{owner:string}|undefined>(m.get('leader'));if(old?.owner===owner)m.delete('leader');await finished;}
async function repairLedger(){const db=await open(),keys=await request<IDBValidKey[]>(db.transaction('blocks').objectStore('blocks').getAllKeys()),known=new Set(await request<IDBValidKey[]>(db.transaction('ledger').objectStore('ledger').getAllKeys()));for(const id of keys){if(known.has(id))continue;const b=await block(String(id));if(!b)continue;let tuples:any[][]|undefined;if(b.id.startsWith('candle:'))try{tuples=await unpack(b);}catch{damaged.add(b.id);}const tx=db.transaction(['blocks','ledger'],'readwrite'),finished=done(tx),current=await request<BlockRecord|undefined>(tx.objectStore('blocks').get(id));if(current?.revision===b.revision)tx.objectStore('ledger').put(manifest(b,tuples));await finished;}}
async function rangeManifest(from:number,to:number,prefix:string){const db=await open();return (await request<Manifest[]>(db.transaction('ledger').objectStore('ledger').index('base').getAll(IDBKeyRange.bound(Math.floor(from/BLOCK)*BLOCK,to)))).filter(r=>r.id.startsWith(prefix));}
export async function firstMissingCandle(asset:Asset,from:number,to:number){const map=new Map((await rangeManifest(from,to,`candle:${asset}:60000:`)).map(r=>[r.base,r.completeMask??0]));for(let t=Math.ceil(from/60000)*60000;t<to;t+=60000){const base=Math.floor(t/BLOCK)*BLOCK;if(!((map.get(base)??0)&(1<<Math.floor((t-base)/60000))))return t;}return null;}
export async function deleteMeta(key:string){const db=await open(),tx=db.transaction('meta','readwrite'),finished=done(tx);tx.objectStore('meta').delete(key);await finished;}
export async function marketHistoryMeta(key:string,value:unknown,fence:CollectorFence){
 const db=await open(),tx=db.transaction('meta','readwrite'),finished=done(tx);void finished.catch(()=>{});
 if(!fence.current()||await request(tx.objectStore('meta').get('collector-term'))!==fence.term){tx.abort();await finished.catch(()=>{});return false;}
 if(value===undefined)tx.objectStore('meta').delete(key);else tx.objectStore('meta').put(value,key);await finished;return true;
}
export type MarketHead={base:number;key:string;dirty:boolean};
export async function marketHistoryHead(base:number):Promise<MarketHead|undefined>{
 const db=await open(),records=await request<Manifest[]>(db.transaction('ledger').objectStore('ledger').index('base').getAll(IDBKeyRange.only(base)));if(!records.length)return undefined;
 return {base,key:records.sort((a,b)=>a.id.localeCompare(b.id)).map(r=>r.id+':'+r.revision).join('|'),dirty:!!await getMeta('market-history-dirty:'+base)};
}
export async function marketHistoryHeads():Promise<MarketHead[]>{
 const db=await open(),records=await request<Manifest[]>(db.transaction('ledger').objectStore('ledger').getAll()),keys=await request<IDBValidKey[]>(db.transaction('meta').objectStore('meta').getAllKeys()),dirty=new Set(keys.filter(k=>String(k).startsWith('market-history-dirty:')).map(k=>Number(String(k).split(':')[1]))),groups=new Map<number,Manifest[]>();
 for(const r of records){const g=groups.get(r.base)??[];g.push(r);groups.set(r.base,g);}
 return [...groups].map(([base,g])=>({base,key:g.sort((a,b)=>a.id.localeCompare(b.id)).map(r=>r.id+':'+r.revision).join('|'),dirty:dirty.has(base)})).sort((a,b)=>a.base-b.base);
}
export async function marketHistoryContent(base:number){
 const [rows,byAsset]=await Promise.all([loadRows(base,base+BLOCK-1),Promise.all(ASSETS.map(a=>loadCandles(a,base,base+BLOCK-1)))]);
 return marketContent({...emptyMarketBlock(base),rows:rows.filter(r=>r.cadence===60000),candles:byAsset.flat().filter(c=>c.interval===60000&&c.closed&&c.t+60000<=Date.now())});
}
/** Referenced queue entries, not duplicated history bodies. Existing history is discovered once. */
export async function discoverMarketHistory(){
 if(await getMeta('market-history-discovered'))return;
 for(const group of await marketHistoryHeads()){
  const db=await open(),tx=db.transaction('meta','readwrite'),finished=done(tx);tx.objectStore('meta').put(true,'market-history-dirty:'+group.base);await finished;
 }
 await setMeta('market-history-discovered',true);
}
export type HistoryTransfer={key:string;assignment:string;version:number;hash:string;outcome:OfferOutcome;at:number};
export type HistoryScan={assignment:string;cursor:number;scanned:number;total:number;complete:boolean};
/** Re-enumerate all local history after designation, regardless of chart range or old discovery flags. */
export async function scanMarketHistory(assignment:string,fence:CollectorFence,budget=64):Promise<HistoryScan>{
 let scan=await getMeta<HistoryScan>('market-history-source-scan');const heads=await marketHistoryHeads();
 if(scan?.assignment!==assignment)scan={assignment,cursor:-1,scanned:0,total:heads.length,complete:false};
 if(scan.complete)return scan;
 const part=heads.filter(h=>h.base>scan!.cursor).slice(0,budget);
 for(const h of part){if(!fence.current())return scan;if(!await marketHistoryMeta('market-history-dirty:'+h.base,true,fence))return scan;scan={...scan,cursor:h.base,scanned:scan.scanned+1};}
 scan.total=Math.max(scan.total,heads.length);scan.complete=!heads.some(h=>h.base>scan!.cursor);await marketHistoryMeta('market-history-source-scan',scan,fence);return scan;
}
export async function historyTransferQueue(assignment:string){
 const heads=await marketHistoryHeads(),db=await open(),records=await request<(HistoryTransfer&{base:number})[]>(db.transaction('meta').objectStore('meta').getAll(IDBKeyRange.bound('market-history-transfer:','market-history-transfer:\uffff'))),byBase=new Map(records.map(r=>[r.base,r]));
 const counts={saved:0,valuesSaved:0,superseded:0,conflicts:0};
 const pending=heads.filter(h=>{const p=byBase.get(h.base);if(p?.key===h.key&&p.assignment===assignment){const key=({saved:'saved','values-saved':'valuesSaved',superseded:'superseded',conflict:'conflicts'} as const)[p.outcome];counts[key]++;return false;}return h.dirty;});
 return {heads,pending,counts};
}
export async function recordHistoryTransfer(base:number,value:HistoryTransfer,fence:CollectorFence){
 const db=await open(),tx=db.transaction(['meta','ledger'],'readwrite'),finished=done(tx);void finished.catch(()=>{});
 const headers=(await request<Manifest[]>(tx.objectStore('ledger').index('base').getAll(IDBKeyRange.only(base)))).sort((a,b)=>a.id.localeCompare(b.id));
 if(!fence.current()||await request(tx.objectStore('meta').get('collector-term'))!==fence.term||headers.map(r=>r.id+':'+r.revision).join('|')!==value.key){await finished;return false;}
 // This suppresses repeated offers only. It deliberately grants NO capacity-cleanup proof.
 tx.objectStore('meta').put({...value,base},'market-history-transfer:'+base);await finished;return true;
}
export async function applyMarketCloud(remote:MarketBlock,fence:CollectorFence){
 if(!fence.current())throw new Error('STALE_COLLECTOR_WRITE');
 const old=await marketHistoryContent(remote.base),merged=await mergeMarketContent(old,remote,true,true);
 // Keep same-quality local candle conflicts protected until a real resolution.
 const unchanged=await marketHash(old)===await marketHash(merged.content);
 if(!unchanged)await save(merged.content.rows,merged.content.candles,true,{...fence,fromCloud:true});
 if(!fence.current())throw new Error('STALE_COLLECTOR_WRITE');
 const seen=await getMeta<{version:number}>('market-history-seen:'+remote.base);if((seen?.version??-1)<=remote.version)await marketHistoryMeta('market-history-seen:'+remote.base,{version:remote.version,hash:remote.sha256},fence);
 const acknowledged=await confirmMarketCloud(remote,fence);
 return {changed:!unchanged,acknowledged,conflicts:merged.conflicts};
}
export async function confirmMarketCloud(remote:MarketBlock,fence:CollectorFence){
 const head=await marketHistoryHead(remote.base);if(!head||!fence.current())return false;
 const content=await marketHistoryContent(remote.base);if(await marketHash(content)!==remote.sha256)return false;
 const allCandles=(await Promise.all(ASSETS.map(a=>loadCandles(a,remote.base,remote.base+BLOCK-1)))).flat();
 const db=await open(),tx=db.transaction(['blocks','ledger','meta'],'readwrite'),finished=done(tx);void finished.catch(()=>{});
 const headers=(await request<Manifest[]>(tx.objectStore('ledger').index('base').getAll(IDBKeyRange.only(remote.base)))).sort((a,b)=>a.id.localeCompare(b.id));
 if(!fence.current()||headers.map(r=>r.id+':'+r.revision).join('|')!==head.key||await request(tx.objectStore('meta').get('collector-term'))!==fence.term){tx.abort();await finished.catch(()=>{});return false;}
 for(const h of headers){const b=await request<BlockRecord>(tx.objectStore('blocks').get(h.id));
  // An open candle is deliberately omitted from the upload; it is not backed up yet.
  const own=allCandles.filter(c=>b.id.startsWith('candle:'+c.asset+':'));
  const complete=!damaged.has(b.id)&&(b.id.startsWith('row:')||own.length>0&&own.every(c=>c.interval===60000&&c.closed&&c.t+60000<=Date.now()));
  if(complete){b.marketCloudRevision=b.revision;tx.objectStore('blocks').put(b);tx.objectStore('ledger').put({...h,marketCloudRevision:h.revision});}
 }
 tx.objectStore('meta').delete('market-history-dirty:'+remote.base);tx.objectStore('meta').put({key:head.key,version:remote.version,hash:remote.sha256,at:Date.now()},'market-history-ack:'+remote.base);await finished;return true;
}
let depthViewCache:{key:string;groups:Map<number,{signature:string;rows:StoredRow[];latest?:StoredRow}>}|undefined;
const candleViewCaches=new Map<Asset,{key:string;groups:Map<number,{signature:string;rows:StoredCandle[]}>}>();
const groupManifests=(records:Manifest[],span:number)=>{const groups=new Map<number,Manifest[]>();for(const m of records){const t=Math.floor(m.base/span)*span,group=groups.get(t)??[];group.push(m);groups.set(t,group);}return groups;};
export async function loadRowsView(from:number,to:number,interval:Interval,selection:DepthViewSelection){
 const key=interval+':'+JSON.stringify(selection);if(depthViewCache?.key!==key)depthViewCache={key,groups:new Map()};const cache=depthViewCache,span=Math.max(BLOCK,interval),groups=groupManifests(await rangeManifest(from,to,'row:'),span),result:StoredRow[]=[];let latest:StoredRow|undefined;
 for(const [base,records]of groups){const start=Math.max(from,base),end=Math.min(to,base+span-1),signature=records.map(r=>r.id+':'+r.revision).join('|')+':'+Math.ceil(start/60000)+':'+Math.floor(end/60000);let cached=cache.groups.get(base);
  if(cached?.signature!==signature){const accumulator=new DepthViewAccumulator(interval,start,end,selection);for(const m of records){const rows:StoredRow[]=[];for(const tuple of await safeUnpack(m.id))try{const r=rowFrom(tuple,m.base);validateRow(r);if(r.t>=m.base&&r.t<m.base+BLOCK)rows.push(r);}catch{damaged.add(m.id);}for(const row of minuteRows(rows))accumulator.add(row);}cached={signature,rows:accumulator.result().filter(r=>!!r.bucket),latest:accumulator.latest};cache.groups.set(base,cached);}
  result.push(...cached.rows);if(cached.latest&&(!latest||cached.latest.t>latest.t))latest=cached.latest;
 }
 for(const base of cache.groups.keys())if(!groups.has(base))cache.groups.delete(base);if(latest)result.push(latest);return result;
}
export async function loadCandlesView(asset:Asset,from:number,to:number,interval:Interval){
 if(interval<=60000){const result:StoredCandle[]=[];for(const m of await rangeManifest(from,to,`candle:${asset}:60000:`))for(const tuple of await safeUnpack(m.id)){const c=candleFrom(tuple,m.base,asset,60000);if(validCandle(c)&&c.t>=from&&c.t<=to)result.push(c);}return result.sort((a,b)=>a.t-b.t);}const key=String(interval);if(candleViewCaches.get(asset)?.key!==key)candleViewCaches.set(asset,{key,groups:new Map()});const cache=candleViewCaches.get(asset)!,span=Math.max(BLOCK,interval),groups=groupManifests(await rangeManifest(from,to,`candle:${asset}:60000:`),span),result:StoredCandle[]=[];
 for(const [base,records]of groups){const start=Math.max(from,base),end=Math.min(to,base+span-1),signature=records.map(r=>r.id+':'+r.revision).join('|')+':'+Math.ceil(start/60000)+':'+Math.floor(end/60000)+':current='+(Math.floor(to/interval)*interval>=base&&Math.floor(to/interval)*interval<base+span?Math.floor(to/interval)*interval:-1);let cached=cache.groups.get(base);
  if(cached?.signature!==signature){const accumulator=new CandleViewAccumulator(asset,interval,start,to);for(const m of records)for(const tuple of await safeUnpack(m.id)){const c=candleFrom(tuple,m.base,asset,60000);if(validCandle(c)&&c.t>=m.base&&c.t<m.base+BLOCK)accumulator.add(c);}cached={signature,rows:accumulator.result()};cache.groups.set(base,cached);}result.push(...cached.rows);
 }
 for(const base of cache.groups.keys())if(!groups.has(base))cache.groups.delete(base);
 return result.sort((a,b)=>a.t-b.t);
}
