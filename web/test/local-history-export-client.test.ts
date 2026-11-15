import {test} from 'node:test';
import assert from 'node:assert/strict';
import {localHistoryExport} from '../src/history-export/client';
import {LOCAL_EXPORT_LOCK,STORAGE_MAINTENANCE_LOCK} from '../shared/local-history-export';
const events=new EventTarget();
let mode='ok',writes=0,closed=0,aborted=0,created=0,terminated=0;
const summary={complete:true,candles:3,depthRows:1,blocks:1};
const file={async write(){writes++;if(mode==='disk-full')throw new Error('DISK_FULL');},async close(){if(mode==='close-failure')throw Error('CLOSE_FAILED');closed++;},async abort(){aborted++;}};
const handle={async createWritable(){created++;return file;}};
const fakeWindow={showSaveFilePicker(){if(mode==='picker-throws')throw new DOMException('No activation','SecurityError');if(mode==='picker-cancel')return Promise.reject(new DOMException('cancel','AbortError'));return Promise.resolve(handle);},addEventListener:events.addEventListener.bind(events),removeEventListener:events.removeEventListener.bind(events)};
Object.defineProperty(globalThis,'window',{value:fakeWindow,configurable:true});
class ExportWorker{
 onmessage:((e:{data:any})=>void)|undefined;onerror:(()=>void)|undefined;onmessageerror:(()=>void)|undefined;
 postMessage(m:any){if(m.type==='start')queueMicrotask(()=>{if(mode==='hang')return;if(mode==='worker-error'){this.onerror?.();return;}this.onmessage?.({data:{type:'chunk',bytes:new Uint8Array([31,139])}});});else if(m.type==='ack')queueMicrotask(()=>this.onmessage?.({data:{type:'complete',result:summary}}));}
 terminate(){terminated++;}
}
Object.defineProperty(globalThis,'Worker',{value:ExportWorker,configurable:true});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function reset(next='ok'){mode=next;writes=closed=aborted=created=terminated=0;}
async function available(){return navigator.locks.request(LOCAL_EXPORT_LOCK,{ifAvailable:true},lock=>!!lock);}

test('success is reported only after file close; the worker and locks are released',async()=>{
 reset();await localHistoryExport.start();assert.equal(localHistoryExport.snapshot().phase,'complete');assert.equal(writes,1);assert.equal(closed,1);assert.equal(aborted,0);assert.equal(terminated,1);assert.ok(await available());
});
test('another tab holding the export lock prevents a second writer',async()=>{
 reset();await navigator.locks.request(LOCAL_EXPORT_LOCK,async()=>{await localHistoryExport.start();assert.equal(localHistoryExport.snapshot().phase,'error');assert.match(localHistoryExport.snapshot().message,/其他分頁/);assert.equal(created,0);});assert.ok(await available());
});
test('export waits for cleanup without acquiring the collection lock; cancellation releases the queued request',async()=>{
 reset();await navigator.locks.request(STORAGE_MAINTENANCE_LOCK,async()=>{
  const job=localHistoryExport.start();await tick();assert.equal(localHistoryExport.snapshot().phase,'waiting');assert.equal(created,0);
  assert.ok(await navigator.locks.request('marketdepth-collector-unaffected',{ifAvailable:true},l=>!!l));
  localHistoryExport.cancel();await job;assert.equal(localHistoryExport.snapshot().phase,'cancelled');
 });assert.ok(await available());
});
test('file write, file close, worker and synchronous picker failures never report success',async()=>{
 for(const failure of ['disk-full','close-failure','worker-error','picker-throws']){
  reset(failure);await localHistoryExport.start();assert.equal(localHistoryExport.snapshot().phase,'error',failure);assert.equal(closed,0);if(failure!=='picker-throws')assert.equal(aborted,1);assert.ok(await available());
 }
});
test('cancelling an active worker aborts the file and leaves existing history untouched',async()=>{
 reset('hang');const job=localHistoryExport.start();for(let i=0;i<5&&localHistoryExport.snapshot().phase!=='exporting';i++)await tick();assert.equal(localHistoryExport.snapshot().phase,'exporting');localHistoryExport.cancel();await job;
 assert.equal(localHistoryExport.snapshot().phase,'cancelled');assert.equal(aborted,1);assert.equal(closed,0);assert.equal(terminated,1);assert.ok(await available());
});
test('picker cancellation and unsupported browsers are handled without starting an export',async()=>{
 reset('picker-cancel');await localHistoryExport.start();assert.equal(localHistoryExport.snapshot().phase,'cancelled');assert.equal(created,0);assert.ok(await available());
 const original=fakeWindow.showSaveFilePicker;(fakeWindow as any).showSaveFilePicker=undefined;
 await localHistoryExport.start();assert.equal(localHistoryExport.snapshot().phase,'error');assert.match(localHistoryExport.snapshot().message,/Chrome 或 Edge/);fakeWindow.showSaveFilePicker=original;
});
