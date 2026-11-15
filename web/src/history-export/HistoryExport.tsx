import {useSyncExternalStore} from 'react';
import {Download,X} from 'lucide-react';
import {localHistoryExport} from './client';
export function HistoryExport(){
 const s=useSyncExternalStore(localHistoryExport.subscribe,localHistoryExport.snapshot),busy=['choosing','waiting','exporting','finalizing','cancelling'].includes(s.phase),p=s.progress;
 return <div className="local-history-export">
  <div className="local-export-actions"><button type="button" className="local-export-button" disabled={busy||!localHistoryExport.supported()} onClick={()=>void localHistoryExport.start()}><Download size={14}/>匯出本機全部歷史</button>{busy&&<button type="button" className="local-export-cancel" disabled={s.phase==='cancelling'||s.phase==='finalizing'} onClick={localHistoryExport.cancel}><X size={13}/>取消</button>}</div>
  <small>BTC／ETH／SOL · 1 分鐘 · 原始 JSONL.gz</small>
  {!localHistoryExport.supported()&&<p role="status">請使用支援串流檔案儲存的桌面 Chrome／Edge。</p>}
  <div role="status" aria-live="polite">{p&&busy&&<><progress aria-label="歷史匯出進度" max={p.totalBlocks} value={p.blocks}/><span>{p.blocks.toLocaleString()}／{p.totalBlocks.toLocaleString()} 區塊 · {(p.depthRows+p.candles).toLocaleString()} 筆</span></>}{s.message&&<p className={s.phase==='error'?'ask-text':''}>{s.message}</p>}</div>
 </div>;
}
