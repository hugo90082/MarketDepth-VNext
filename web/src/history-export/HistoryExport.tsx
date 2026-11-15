import {useRef,useSyncExternalStore} from 'react';
import {Download,Upload,X} from 'lucide-react';
import {localHistoryExport} from './client';
export function HistoryExport(){
 const s=useSyncExternalStore(localHistoryExport.subscribe,localHistoryExport.snapshot),busy=['choosing','waiting','exporting','importing','finalizing','cancelling'].includes(s.phase),p=s.progress;
 const inputRef=useRef<HTMLInputElement>(null);
 return <div className="local-history-export">
  <div className="local-export-actions">
   <button type="button" className="local-export-button" disabled={busy||!localHistoryExport.supported()} onClick={()=>void localHistoryExport.start()}><Download size={14}/>匯出本機全部歷史</button>
   <button type="button" className="local-export-button" disabled={busy||!localHistoryExport.importSupported()} onClick={()=>inputRef.current?.click()}><Upload size={14}/>匯入本機歷史</button>
   <input ref={inputRef} type="file" accept=".gz,.jsonl,application/gzip,application/x-gzip" hidden onChange={e=>{const f=e.target.files?.[0];e.target.value='';if(f)void localHistoryExport.importFile(f);}}/>
   {busy&&<button type="button" className="local-export-cancel" disabled={s.phase==='cancelling'||s.phase==='finalizing'} onClick={localHistoryExport.cancel}><X size={13}/>取消</button>}
  </div>
  <small>BTC／ETH／SOL · 1 分鐘 · 原始 JSONL.gz 匯出／匯入</small>
  {!localHistoryExport.supported()&&<p role="status">匯出請使用支援串流檔案儲存的桌面 Chrome／Edge。</p>}
  <div role="status" aria-live="polite">{p&&busy&&<><progress aria-label="歷史作業進度" max={p.totalBlocks} value={p.blocks}/><span>{p.blocks.toLocaleString()}／{p.totalBlocks.toLocaleString()} 區塊 · {(p.depthRows+p.candles).toLocaleString()} 筆</span></>}{s.message&&<p className={s.phase==='error'?'ask-text':''}>{s.message}</p>}</div>
 </div>;
}
