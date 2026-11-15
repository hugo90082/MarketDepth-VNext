import {useSyncExternalStore} from 'react';
import {marketHistoryRuntime} from './runtime';
import {dateTime} from '../format';
export function MarketHistoryStatus(){
 const s=useSyncExternalStore(marketHistoryRuntime.subscribe,marketHistoryRuntime.snapshot),d=s.download;
 return <><dl className="market-history-status">
  <div><dt>VNext 雲端範圍</dt><dd>{s.cloud?.oldest!==null&&s.cloud?.oldest!==undefined?`${dateTime(s.cloud.oldest)} — ${dateTime(s.cloud.newest!)}`:'尚無區塊'}</dd></div>
  <div><dt>同步狀態</dt><dd>{s.phase}</dd></div>
  <div><dt>區間歷史載入</dt><dd>{d?`${d.blocks}／${d.total} 區塊 · ${d.complete?'已同步':'同步中'}`:'自動同步中'}</dd></div>
 </dl>{s.error&&<div className="quality-note ask-text" role="status">{s.error}</div>}{s.downloadError&&<div className="quality-note ask-text" role="status">{s.downloadError}</div>}</>;
}
