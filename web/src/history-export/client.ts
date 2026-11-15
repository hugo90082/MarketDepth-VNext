import {LOCAL_EXPORT_LOCK,STORAGE_MAINTENANCE_LOCK,type ExportProgress,type ExportSummary} from '../../shared/local-history-export';
type Phase='idle'|'choosing'|'waiting'|'exporting'|'finalizing'|'cancelling'|'complete'|'cancelled'|'error';
type State={phase:Phase;progress:ExportProgress|null;summary:ExportSummary|null;message:string};
type Picker=(options:{suggestedName:string;types:{description:string;accept:Record<string,string[]>}[]})=>Promise<FileSystemFileHandle>;
let state:State={phase:'idle',progress:null,summary:null,message:''},controller:AbortController|undefined;
const listeners=new Set<()=>void>(),active=()=>['choosing','waiting','exporting','finalizing','cancelling'].includes(state.phase);
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
   if(!lock)throw new Error('其他分頁正在匯出本機歷史，請等候完成。');
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
export const localHistoryExport={snapshot:()=>state,subscribe(f:()=>void){listeners.add(f);return()=>listeners.delete(f);},supported:()=>!!picker()&&!!navigator.locks&&typeof Worker!=='undefined'&&typeof CompressionStream!=='undefined',start,cancel(){if(active()&&state.phase!=='finalizing'){notify({phase:'cancelling',message:'正在取消匯出…'});controller?.abort(new DOMException('使用者取消匯出','AbortError'));}}};
