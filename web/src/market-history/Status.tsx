import {useState,useSyncExternalStore} from 'react';
import {marketHistoryRuntime} from './runtime';
import {dateTime} from '../format';
import {ASSETS} from '../../shared/model';
export function MarketHistoryStatus({compare}:{compare:()=>void}){
 const s=useSyncExternalStore(marketHistoryRuntime.subscribe,marketHistoryRuntime.snapshot),[copied,setCopied]=useState(''),source=s.source,d=s.download;
 return <><div className="market-source-code"><label htmlFor="market-source-code">本機來源代碼</label><div><input id="market-source-code" aria-label="本機來源代碼" readOnly value={source?.code??'讀取中'} onFocus={e=>e.currentTarget.select()}/><button type="button" disabled={!source} onClick={()=>void navigator.clipboard.writeText(source!.code).then(()=>setCopied('已複製')).catch(()=>setCopied('請選取來源代碼後複製'))}>複製</button></div><small role="status">{copied||'請在資料較完整的電腦複製代碼，交由管理者綁定；此代碼不是密碼。'}</small></div><dl className="market-history-status">
  <div><dt>來源模式</dt><dd>{!source?'讀取中':!source.valid?'管理端設定有誤':!source.configured?'尚未指定，沿用原上傳資格':source.isPrimary?'指定歷史上傳來源':'下載與本機收集，不上傳'}</dd></div>
  <div title="最早與最晚區塊不代表中間每分鐘都有有效資料。"><dt>雲端區塊範圍</dt><dd>{s.cloud?.oldest!==null&&s.cloud?.oldest!==undefined?`${dateTime(s.cloud.oldest)} — ${dateTime(s.cloud.newest!+900000)}`:'尚無區塊'}<span>{s.cloud?` · ${s.cloud.blocks} 區塊`:' · 讀取中'}</span></dd></div>
  <div><dt>雲端同步</dt><dd>{s.phase}{s.cloud&&<span> · v{s.cloud.version}</span>}</dd></div>
  {source?.canUpload&&<><div><dt>上傳資格</dt><dd>{s.eligible?'已完成 Railway 比對':s.authenticated?'待 Railway 比對':'未登入；可下載與本機收集'}{s.eligible&&s.expiresAt&&<span> · 至 {dateTime(s.expiresAt)}</span>}</dd></div>
  <div><dt>全部本機歷史盤點</dt><dd>{s.scan?`${s.scan.scanned}／${s.scan.total} 區塊${s.scan.complete?' · 已盤點':' · 可續跑'}`:'等待盤點'}</dd></div>
  <div><dt>本機待保存</dt><dd>{s.pending}<span> 區塊 · 每 30 秒一批</span></dd></div>
  <div><dt>保存確認／數值保存</dt><dd>{s.counts.saved}／{s.counts.valuesSaved}<span> 區塊</span></dd></div>
  <div><dt>較高品質取代／衝突</dt><dd>{s.counts.superseded}／{s.counts.conflicts}<span> 區塊</span></dd></div></>}
  <div><dt>歷史下載</dt><dd>{d?`${d.blocks}／${d.total} 區塊 · ${d.complete?'已下載可取得區塊':'補齊中'}`:'等待所選區間'}</dd></div>
 </dl>{d&&<details className="market-download-details"><summary>下載明細 · {dateTime(d.from)} — {dateTime(d.to)}</summary><p>雲端已讀取的一分鐘資料；深度為 ALL4 可計算分鐘數，0–300／0–750 bps。每商品預期 {d.expected} 格；{d.complete?'下載完成不代表來源沒有缺格或缺值。':'下載中，差額包含尚未讀取的區塊，暫不代表雲端缺值。'}</p>{ASSETS.map((asset,i)=>{const a=d.coverage.assets[i];return <p key={asset}><b>{asset}</b> K 線 {a.candles}，{d.complete?'缺':'差額'} {Math.max(0,d.expected-a.candles)}；深度 {a.depth300}／{a.depth750}，{d.complete?'缺':'差額'} {Math.max(0,d.expected-a.depth300)}／{Math.max(0,d.expected-a.depth750)}</p>;})}<p>缺少的雲端價格會由單一主控向 Binance 補齊；本機已補齊但尚未上傳的 K 線不計入上述雲端數字。深度缺格不補造數值。</p><p>與本機衝突：{d.coverage.conflicts} 筆，原資料保留。</p></details>}{source?.canUpload&&!s.eligible&&<button className="market-history-enable" onClick={()=>void marketHistoryRuntime.prepareEnable().then(ok=>{if(ok)compare();})}>比對並啟用 Sites 保存</button>}{s.counts.valuesSaved>0&&source?.canUpload&&<div className="quality-note">相同數值已保存；未獲雲端完整確認的本機來源資訊仍受保護，不授予清理資格。</div>}{s.error&&<div className="quality-note ask-text" role="status">{s.error}</div>}{s.downloadError&&<div className="quality-note ask-text" role="status">{s.downloadError}</div>}</>;
}
