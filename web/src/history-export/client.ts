import {LOCAL_EXPORT_LOCK,STORAGE_MAINTENANCE_LOCK,type ExportProgress,type ExportSummary} from '../../shared/local-history-export';
import {CONTRACT,type StoredCandle,type StoredRow} from '../../shared/contract';
import {save} from '../storage';
import {marketRuntime} from '../runtime/client';
type Phase='idle'|'choosing'|'waiting'|'exporting'|'importing'|'finalizing'|'cancelling'|'complete'|'cancelled'|'error';
type State={phase:Phase;progress:ExportProgress|null;summary:ExportSummary|null;message:string};
type Picker=(options:{suggestedName:string;types:{description:string;accept:Record<string,string[]>}[]})=>Promise<FileSystemFileHandle>;
let state:State={phase:'idle',progress:null,summary:null,message:''},controller:AbortController|undefined;
const listeners=new Set<()=>void>(),active=()=>['choosing','waiting','exporting','importing','finalizing','cancelling'].includes(state.phase);
const notify=(patch:Partial<State>)=>{state={...state,...patch};for(const listener of listeners)listener();};
const picker=()=>(window as Window&{showSaveFilePicker?:Picker}).showSaveFilePicker;
function guard(e:BeforeUnloadEvent){e.preventDefault();e.returnValue='';}
async function workerExport(file:FileSystemWritableFileStream,signal:AbortSignal,startedAt:number){
 const worker=new Worker(new URL('./export.worker.ts',import.meta.url),{type:'module'});let writing=Promise.resolve();
 try{return await new Promise<ExportSummary>((resolve,reject)=>{
  const stop=()=>reject(signal.reason);signal.addEventListener('abort',stop,{once:true});
  worker.onerror=()=>reject(new Error('匯出 Worker 發生錯誤，檔案未標示完成。'));
  worker.onmessageerror=()=>reject(new Error('無法讀取匯出 Worker 的資料，檔案未標示完成。'));
  worker.onmessage=e=>{
   if(signal.aborted)return;
   if(e.data.type==='chunk'){
    writing=writing.then(async()=>{signal.throwIfAborted();await file.write(e.data.bytes);signal.throwIfAborted();worker.postMessage({type:'ack'});});void writing.catch(reject);
   }else if(e.data.type==='progress')notify({progress:e.data.progress});
   else if(e.data.type==='complete')resolve(e.data.result);
   else if(e.data.type==='error')reject(new Error(e.data.message));
  };
  signal.throwIfAborted();worker.postMessage({type:'start',startedAt});
 }).finally(()=>{worker.terminate();});}finally{await writing.catch(()=>{});}
}
async function start(){
 if(active())return;
 const pick=picker();if(!pick||!navigator.locks||typeof Worker==='undefined'||typeof CompressionStream==='undefined'){notify({phase:'error',message:'此瀏覽器不支援串流檔案匯出，請使用桌面 Chrome 或 Edge。'});return;}
 controller=new AbortController();const signal=controller.signal,startedAt=Date.now();
 notify({phase:'choosing',progress:null,summary:null,message:''});window.addEventListener('beforeunload',guard);
 // Invoke the picker synchronously within the button's user activation.
 try{
  const selection=pick.call(window,{suggestedName:`marketdepth-local-history-${new Date(startedAt).toISOString().replace(/[:.]/g,'-')}.jsonl.gz`,types:[{description:'MarketDepth 原始歷史（JSONL gzip）',accept:{'application/gzip':['.jsonl.gz']}}]});void selection.catch(()=>{});
  await navigator.locks.request(LOCAL_EXPORT_LOCK,{ifAvailable:true},async lock=>{
   if(!lock)throw new Error('其他分頁正在匯出或匯入本機歷史，請等候完成。');
   const handle=await selection;signal.throwIfAborted();notify({phase:'waiting',message:'等待容量清理完成；行情持續收集。'});
   await navigator.locks.request(STORAGE_MAINTENANCE_LOCK,{signal},async()=>{
    signal.throwIfAborted();let file:FileSystemWritableFileStream|undefined;
    try{
     file=await handle.createWritable();signal.throwIfAborted();notify({phase:'exporting',message:''});
     const summary=await workerExport(file,signal,startedAt);signal.throwIfAborted();notify({phase:'finalizing',message:'正在完成檔案儲存…'});await file.close();
     notify({phase:'complete',summary,message:`已匯出 ${summary.candles.toLocaleString()} 筆 K 線、${summary.depthRows.toLocaleString()} 個深度時間格（含三商品）。`});
    }catch(e){await file?.abort(e).catch(()=>{});throw e;}
   });
  });
 }catch(e){if(signal.aborted||(e as DOMException)?.name==='AbortError')notify({phase:'cancelled',message:'已取消匯出，未修改本機歷史。'});else notify({phase:'error',message:e instanceof Error?e.message:'寫入匯出檔案失敗，請確認磁碟空間後重試。'});}
 finally{window.removeEventListener('beforeunload',guard);controller=undefined;}
}
async function importFile(file:File){
 if(active())return;
 if(typeof DecompressionStream==='undefined'){notify({phase:'error',message:'此瀏覽器不支援串流解壓縮匯入，請使用桌面 Chrome 或 Edge。'});return;}
 controller=new AbortController();const signal=controller.signal;
 notify({phase:'waiting',progress:{blocks:0,totalBlocks:1,depthRows:0,candles:0},summary:null,message:'正在準備匯入本機歷史檔案…'});
 window.addEventListener('beforeunload',guard);
 try{
  const runImport=async()=>{
   signal.throwIfAborted();
   notify({phase:'importing',message:'正在匯入本機歷史至瀏覽器快取…'});
   const head=new Uint8Array(await file.slice(0,2).arrayBuffer());
   const isGzip=(head.length===2&&head[0]===0x1f&&head[1]===0x8b)||file.name.toLowerCase().endsWith('.gz');
   const byteStream=isGzip?file.stream().pipeThrough(new DecompressionStream('gzip')):file.stream();
   const textStream=byteStream.pipeThrough(new TextDecoderStream());
   const reader=textStream.getReader();
   let buffer='',blocks=0,totalBlocks=1,depthRows=0,candles=0;
   const rowsBatch:StoredRow[]=[],candlesBatch:StoredCandle[]=[];
   const flushBatch=async()=>{
    if(!rowsBatch.length&&!candlesBatch.length)return;
    signal.throwIfAborted();
    await save(rowsBatch.splice(0),candlesBatch.splice(0));
    notify({progress:{blocks:Math.max(1,blocks),totalBlocks:Math.max(1,totalBlocks,blocks),depthRows,candles}});
   };
   const processLine=(line:string)=>{
    const trimmed=line.trim();
    if(!trimmed)return;
    let obj:any;
    try{obj=JSON.parse(trimmed);}catch{return;}
    if(!obj||typeof obj!=='object')return;
    if(obj.type==='manifest'&&typeof obj.blocks==='number'&&obj.blocks>0){
     totalBlocks=obj.blocks;
    }else if(obj.type==='block'){
     blocks++;
    }else if(obj.type==='depth'&&typeof obj.t==='number'&&Array.isArray(obj.d)){
     const row:StoredRow={
      t:obj.t,
      a:typeof obj.a==='number'?obj.a:null,
      cadence:60000,
      d:obj.d,
      source:obj.source==='railway'||obj.source==='recent'||obj.source==='browser'?obj.source:'railway',
      format:CONTRACT.datasetFormat,
      ...(typeof obj.finalVersion==='number'&&obj.finalVersion>=0?{finalVersion:obj.finalVersion}:{}),
      ...(Array.isArray(obj.captured)?{captured:obj.captured}:{}),
      ...(Array.isArray(obj.issues)?{issues:obj.issues}:{}),
      ...(obj.quality?{quality:obj.quality}:{}),
     };
     rowsBatch.push(row);
     depthRows++;
    }else if(obj.type==='candle'&&typeof obj.t==='number'&&typeof obj.asset==='string'){
     const candle:StoredCandle={
      asset:obj.asset,
      interval:60000,
      t:obj.t,
      o:obj.o,
      h:obj.h,
      l:obj.l,
      c:obj.c,
      v:obj.v,
      closed:!!obj.closed,
      complete:!!obj.complete,
      ...(typeof obj.observedAt==='number'?{observedAt:obj.observedAt}:{}),
      ...(obj.source==='binance-usdm'||obj.source==='legacy-30s'||obj.source==='import'?{source:obj.source}:{source:'import'}),
     };
     candlesBatch.push(candle);
     candles++;
    }
   };
   try{
    while(true){
     signal.throwIfAborted();
     const {value,done}=await reader.read();
     if(done)break;
     buffer+=value;
     let idx=buffer.indexOf('\n');
     while(idx!==-1){
      const line=buffer.slice(0,idx);
      buffer=buffer.slice(idx+1);
      processLine(line);
      if(rowsBatch.length+candlesBatch.length>=1200)await flushBatch();
      idx=buffer.indexOf('\n');
     }
    }
    if(buffer.trim())processLine(buffer);
    await flushBatch();
   }finally{
    await reader.cancel().catch(()=>{});
   }
   if(!depthRows&&!candles)throw new Error('檔案中未找到有效的深度或 K 線歷史資料。');
   notify({phase:'finalizing',message:'正在重新整理圖表快取…'});
   const ch=marketRuntime.researchChannel();
   ch?.postMessage({type:'changed'});
   ch?.close();
   window.dispatchEvent(new Event('online'));
   notify({phase:'complete',progress:{blocks:Math.max(1,totalBlocks,blocks),totalBlocks:Math.max(1,totalBlocks,blocks),depthRows,candles},message:`已匯入 ${candles.toLocaleString()} 筆 K 線、${depthRows.toLocaleString()} 個深度時間格（含三商品）。`});
  };
  if(navigator.locks){
   await navigator.locks.request(LOCAL_EXPORT_LOCK,{ifAvailable:true},async lock=>{
    if(!lock)throw new Error('其他分頁正在匯出或匯入本機歷史，請等候完成。');
    await navigator.locks.request(STORAGE_MAINTENANCE_LOCK,{signal},runImport);
   });
  }else{
   await runImport();
  }
 }catch(e){
  if(signal.aborted||(e as DOMException)?.name==='AbortError')notify({phase:'cancelled',message:'已取消匯入。'});
  else notify({phase:'error',message:e instanceof Error?e.message:'匯入本機歷史檔案失敗，請確認檔案格式後重試。'});
 }finally{
  window.removeEventListener('beforeunload',guard);
  controller=undefined;
 }
}
export const localHistoryExport={snapshot:()=>state,subscribe(f:()=>void){listeners.add(f);return()=>listeners.delete(f);},supported:()=>!!picker()&&!!navigator.locks&&typeof Worker!=='undefined'&&typeof CompressionStream!=='undefined',importSupported:()=>typeof DecompressionStream!=='undefined',start,importFile,cancel(){if(active()&&state.phase!=='finalizing'){notify({phase:'cancelling',message:state.phase==='importing'?'正在取消匯入…':'正在取消匯出…'});controller?.abort(new DOMException('使用者取消作業','AbortError'));}}};
