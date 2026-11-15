import {Fragment, useEffect, useRef, useState, useSyncExternalStore} from 'react';
import {ASSETS, type Asset} from '../../shared/model';
import {floating, NOTIONAL, remaining, type ClosedEpisode, type Fill, type Strategy} from '../../shared/strategy-v37';
import {LANES, portfolioNets, shownStates, type Ledger, type Notice} from '../../shared/strategy-v37-ledger';
import {dateTime} from '../format';
import {strategyRuntime} from './runtime';
import {readHistory, type HistoryCursor} from './store';
import './strategy.css';

const money = new Intl.NumberFormat('zh-TW', {minimumFractionDigits:2, maximumFractionDigits:2});
const units = new Intl.NumberFormat('zh-TW', {maximumFractionDigits:3});
const actions: Record<Fill['kind'], string> = {entry:'進場', add:'加碼', trim:'回零減碼 75%', reverse:'反向全平', stop:'停損', expiry:'到期'};
const timestamp = (at: number) => dateTime(at);
const sideName = (strategy: Strategy) => strategy.side === 1 ? '多方' : '空方';
const tone = (value: number | null) => value === null || value === 0 ? '' : value > 0 ? 'v37-positive' : 'v37-negative';
const signed = (value: number | null, scale: number) => value === null ? '—' : (value > 0 ? '+' : '') + money.format(value * scale);
function netText(amount: number) {
 if (!amount) return '零部位';
 return (amount > 0 ? '淨多 ' : '淨空 ') + units.format(Math.abs(amount) / NOTIONAL) + 'N';
}
function noticeText(notice: Notice) {
 if (notice.kind === 'move') return `${notice.asset} ${netText(notice.before)} → ${netText(notice.after)}${notice.provisional ? ' · 待回補對帳' : ''}`;
 const totals = ASSETS.map(asset => asset + ' ' + netText(notice.after[asset])).join('／');
 return `回算摘要 · ${totals} · ${notice.closed} 個結束回合${notice.corrected ? `，修正 ${notice.corrected} 筆` : ''}`;
}

function useStrategy() {
 return useSyncExternalStore(strategyRuntime.subscribe, strategyRuntime.snapshot);
}

export function StrategyToasts() {
 const {toast} = useStrategy();
 if (!toast.length) return null;
 return <div className="v37-toast" role="status">{toast.map(notice =>
  <div key={notice.id}><b>V37 虛擬策略</b><span>{noticeText(notice)}</span></div>)}</div>;
}

function SoundControl() {
 const {sound, primed} = useStrategy();
 const playing = sound && primed;
 return <button className="v37-button" type="button" aria-pressed={playing}
  onClick={() => {void strategyRuntime.sound(!playing);}}>{playing ? '關閉聲音' : '啟用聲音'}</button>;
}

function NotionalControl({notional}: {notional: number}) {
 const [draft, setDraft] = useState(String(notional));
 useEffect(() => setDraft(String(notional)), [notional]);
 return <label className="v37-n" title="每 1N 的美元金額，調整後等比例換算目前與歷史盈虧">
  <span>N</span><input type="number" step="any" inputMode="decimal" value={draft}
   onChange={event => setDraft(event.currentTarget.value)}
   onBlur={event => setDraft(String(strategyRuntime.setNotional(event.currentTarget.valueAsNumber)))}
   onKeyDown={event => {if (event.key === 'Enter') event.currentTarget.blur();}}/>
 </label>;
}

function summaryPnl(asset: Asset, ledger: Ledger) {
 const mark = ledger.marks[asset];
 let totalKnown = !ledger.replay, confirmed = 0, current = 0;
 for (const definition of LANES.filter(lane => lane.asset === asset)) {
  const lane = ledger.lanes[definition.key];
  if (lane.through === null || lane.gap || lane.review.length) totalKnown = false;
  for (const [index, state] of lane.states.entries()) {
   confirmed += state.closedPnl;
   if (!state.episode) continue;
   if (!mark?.fresh || lane.through !== mark.at) {totalKnown = false; continue;}
   current += state.episode.cash + floating(state.episode, definition.strategies[index].side, mark.price);
  }
 }
 return {value:totalKnown ? confirmed + current : confirmed, totalKnown};
}

function Summary({asset, ledger, scale, integrated}: {asset: Asset; ledger: Ledger | null; scale: number; integrated: boolean}) {
 const definitions = LANES.filter(lane => lane.asset === asset);
 const lanes = ledger ? definitions.map(definition => ledger.lanes[definition.key]) : [];
 const started = lanes.filter(lane => lane.through !== null);
 const available = started.filter(lane => !lane.gap).length;
 const gaps = started.flatMap(lane => lane.gap ? [{gap:lane.gap, lane}] : []);
 const oldest = gaps.sort((a, b) => a.gap.at - b.gap.at)[0];
 const confirmed = started.length ? Math.min(...started.map(lane => lane.through!)) : null;
 const net = ledger ? portfolioNets(ledger)[asset] : 0;
 const pnl = integrated && ledger && started.length ? summaryPnl(asset, ledger) : null;
 const status = oldest ? `等待${oldest.gap.reason === 'price' ? '價格' : '深度'} ${timestamp(oldest.gap.at)} · 待回補對帳` :
  ledger?.replay ? '正在回算已保存行情' : available < 5 ? '等待完整小時價格與連續深度' : integrated ? null : '每分鐘檢查出場';
 return <div className="v37-summary">
  <div className="v37-summary-title"><b>{asset}</b><span>{available}／5 區已接續</span></div>
  <div className="v37-net-row">
   <div className={'v37-net ' + tone(net)}>{started.length ? netText(net) : '暖機中'}</div>
   {integrated && <div className="v37-pnl" title={pnl?.totalKnown ?
    '所有策略的歷史已結算、目前已入帳與浮動盈虧合計' : '尚未能計算總盈虧，僅顯示已確認的結束回合'}>
    <span>{pnl && !pnl.totalKnown ? '已結算盈虧' : '總盈虧'}</span>
    <strong className={tone(pnl?.value ?? null)}>{signed(pnl?.value ?? null, scale)}{pnl ? ' USD' : ''}</strong>
   </div>}
  </div>
  <div className="v37-summary-meta">
   {started.length > 0 && <strong>{money.format(Math.abs(net) * scale)} USD</strong>}
   {confirmed !== null && <span>確認至 {timestamp(confirmed)}</span>}
  </div>
  {status && <p>{status}</p>}
 </div>;
}

function FillTable({fills, scale}: {fills: Fill[]; scale: number}) {
 return <div className="v37-scroll"><table className="v37-table v37-fills">
  <thead><tr>{['時間','動作','份額','代理價','名目 USD','費用 USD','入帳 USD'].map(text => <th key={text} scope="col">{text}</th>)}</tr></thead>
  <tbody>{fills.map((fill, index) => <tr key={index}>
   <td>{timestamp(fill.at)}</td><td>{actions[fill.kind]}</td><td>{fill.lot}</td>
   <td>{money.format(fill.price)}</td><td>{money.format(fill.amount * scale)}</td><td>{money.format(fill.fee * scale)}</td>
   <td className={tone(fill.cash)}>{signed(fill.cash, scale)}</td>
  </tr>)}</tbody>
 </table></div>;
}

function RoundHistory({strategy, version, scale}: {strategy: Strategy; version: number; scale: number}) {
 const [rounds, setRounds] = useState<ClosedEpisode[]>([]);
 const [cursor, setCursor] = useState<HistoryCursor>();
 const [loading, setLoading] = useState(true);
 const [error, setError] = useState(false);
 const request = useRef(0);
 function load(before?: HistoryCursor) {
  const id = ++request.current;
  setLoading(true);
  setError(false);
  void readHistory(strategy.id, before).then(page => {
   if (id !== request.current) return;
   setRounds(rows => before ? [...rows, ...page.rows] : page.rows);
   setCursor(page.next);
  }).catch(() => {
   if (id === request.current) setError(true);
  }).finally(() => {
   if (id === request.current) setLoading(false);
  });
 }
 useEffect(() => {load(); return () => {request.current++;};}, [strategy.id, version]);
 return <div className="v37-history">
  <h4>歷史回合</h4>
  {error ? <button className="v37-button" onClick={() => load()}>歷史讀取失敗，重試</button> : null}
  {!rounds.length && <p>{loading ? '讀取本機歷史…' : '尚無結束回合'}</p>}
  {rounds.map(round => <details key={round.id} className="v37-round">
   <summary><span>{timestamp(round.startedAt)} → {timestamp(round.closedAt)}</span>
    <span>{actions[round.reason]}{round.provisional ? ' · 待回補對帳' : ''}</span>
    <b className={tone(round.cash)}>{signed(round.cash, scale)} USD</b></summary>
   <FillTable fills={round.fills} scale={scale}/>
  </details>)}
  {cursor && <button type="button" className="v37-button" disabled={loading} onClick={() => load(cursor)}>{loading ? '讀取中…' : '載入較舊回合'}</button>}
 </div>;
}

function Details({asset, ledger, notional}: {asset: Asset; ledger: Ledger | null; notional: number}) {
 const scale = notional / NOTIONAL;
 const [selected, setSelected] = useState<string | null>(null);
 const detailHeading = useRef<HTMLHeadingElement>(null);
 const detailTrigger = useRef<HTMLButtonElement>(null);
 useEffect(() => {
  if (selected) detailHeading.current?.focus();
 }, [selected]);
 const definitions = LANES.filter(lane => lane.asset === asset);
 const mark = ledger?.marks[asset];
 const columns = ['剩餘 N／明細', '已入帳 USD', '浮動 USD', '歷史累計 USD', '回合'];
 const selectedLane = definitions.find(definition => definition.strategies.some(strategy => strategy.id === selected));
 const selectedStrategy = selectedLane?.strategies.find(strategy => strategy.id === selected);
 const selectedIndex = selectedStrategy ? selectedLane!.strategies.indexOf(selectedStrategy) : -1;
 const episode = selectedLane && ledger ? shownStates(ledger.lanes[selectedLane.key])[selectedIndex]?.episode : null;
 return <div className="v37-detail">
  <div className="v37-meta"><span>1N＝{notional.toLocaleString('zh-TW', {maximumSignificantDigits:21})} USD · 代理成交 · 單邊費用 4 bps</span>
   <span>有效價格 {mark ? timestamp(mark.at) : '—'}{mark && !mark.fresh ? ' · 等待價格' : ''}</span></div>
  <div className="v37-scroll">
   <table className="v37-table v37-strategies" aria-label={asset + ' 逐策略盈虧'}>
    <thead><tr><th rowSpan={2} scope="col">深度 bps</th><th rowSpan={2} scope="col">門檻</th>
     <th colSpan={5} scope="colgroup">多方</th><th colSpan={5} scope="colgroup">空方</th></tr>
     <tr>{[1,-1].flatMap(side => columns.map(label => <th key={side + label} scope="col">{label}</th>))}</tr></thead>
    {definitions.map(definition => {
     const lane = ledger?.lanes[definition.key];
     const thresholds = [...new Set(definition.strategies.map(item => item.threshold))].sort((a,b) => a-b);
     return <tbody key={definition.key}>{thresholds.map((threshold, row) => <tr key={threshold}>
      {row === 0 && <th rowSpan={thresholds.length} scope="rowgroup">0–{definition.key.split(':')[1]}
       {lane?.quality && lane.quality !== 'complete' && <small>{lane.quality === 'partial' ? '部分覆蓋' : '品質未知'}</small>}
       {lane?.gap && <small>等待回補</small>}</th>}
      <th scope="row">{threshold.toFixed(2)}</th>
      {[1,-1].map(side => {
       const index = definition.strategies.findIndex(strategy => strategy.side === side && strategy.threshold === threshold);
       const strategy = definition.strategies[index];
       if (!strategy) return <td key={side} colSpan={5}>—</td>;
       const state = lane && shownStates(lane)[index], confirmed = lane?.states[index];
       const current = state?.episode ?? null;
       const unrealized = current && mark?.fresh && (!lane?.gap || lane.gap.through >= mark.at) ? floating(current, strategy.side, mark.price) : null;
       const active = selected === strategy.id;
       return <Fragment key={strategy.id}>
        <td className="v37-direction-start"><button className="v37-strategy-link" type="button" aria-pressed={active}
         aria-label={`${asset} ${sideName(strategy)} ${strategy.zone} bps 門檻 ${threshold.toFixed(2)} 明細`}
         title={`${strategy.entry}／${strategy.add}`} onClick={event => {
          detailTrigger.current = event.currentTarget;
          setSelected(active ? null : strategy.id);
         }}>
          {lane?.through != null ? units.format(remaining(current) / NOTIONAL) : '—'}
         </button></td>
        <td className={tone(current?.cash ?? null)}>{signed(current?.cash ?? null, scale)}</td>
        <td className={tone(unrealized)}>{signed(unrealized, scale)}</td>
        <td className={tone(confirmed?.closedPnl ?? null)}>{signed(lane?.through != null ? confirmed?.closedPnl ?? 0 : null, scale)}</td>
        <td>{lane?.through != null ? confirmed?.closedCount ?? 0 : '—'}</td>
       </Fragment>;
      })}
     </tr>)}</tbody>;
    })}
   </table>
  </div>
  {selectedStrategy && <section className="v37-selected" aria-label="策略回合明細">
   <header><h3 ref={detailHeading} tabIndex={-1}>{asset} {sideName(selectedStrategy)} · {selectedStrategy.zone} bps · {selectedStrategy.threshold.toFixed(2)}</h3>
    <span>{selectedStrategy.entry}／{selectedStrategy.add}</span><button type="button" className="v37-button"
     onClick={() => {setSelected(null); detailTrigger.current?.focus();}}>關閉明細</button></header>
   <h4>目前回合</h4>
   {episode ? <FillTable fills={episode.fills} scale={scale}/> : <p>目前空倉</p>}
   <RoundHistory key={selectedStrategy.id} strategy={selectedStrategy} version={ledger?.historyVersions[selectedStrategy.id] ?? 0} scale={scale}/>
  </section>}
 </div>;
}

export function StrategyPanel({asset}: {asset?: Asset}) {
 const {ledger, notices, error, capable, notional} = useStrategy();
 const [selectedAsset, select] = useState<Asset>('BTC');
 const [open, setOpen] = useState(false);
 const dialog = useRef<HTMLDialogElement>(null);
 const trigger = useRef<HTMLButtonElement>(null);
 useEffect(() => {
  const node = dialog.current;
  if (open && node && !node.open) node.showModal();
  if (!open && node?.open) node.close();
 }, [open]);
 const close = () => {setOpen(false); trigger.current?.focus();};
 const filteredNotices = notices.filter(notice => !asset || notice.kind === 'replay' || notice.asset === asset);
 const noticeLog = <details className="v37-notices"><summary>提醒紀錄</summary>
  <ul>{filteredNotices.map(notice =>
   <li key={notice.id}><time>{timestamp(notice.at)}</time> {noticeText(notice)}
    {notice.kind === 'replay' && <small>{timestamp(notice.from)} → {timestamp(notice.through)}</small>}</li>)}</ul>
  {!filteredNotices.length && <p>尚無提醒</p>}
 </details>;
 return <section className={'v37-panel' + (asset ? ' v37-sidebar' : '')} aria-label="V37 策略觀測">
  <header className="v37-heading"><div><h2>V37 策略觀測</h2><span>虛擬部位</span></div>
   <div className="v37-controls"><NotionalControl notional={notional}/><SoundControl/></div>
  </header>
  {error && <p role="status" className="v37-message">{error}</p>}
  {capable === false && <p role="status" className="v37-message">請重新整理目前負責收集行情的分頁，以啟用策略。</p>}
  <div className="v37-summaries">{(asset ? [asset] : ASSETS).map(item =>
   <Summary key={item} asset={item} ledger={ledger} scale={notional / NOTIONAL} integrated={!asset}/>)}</div>
  {asset ? <>
   <button ref={trigger} type="button" className="v37-button v37-open" onClick={() => setOpen(true)}>查看 {asset} 策略與歷史</button>
   <dialog ref={dialog} className="v37-dialog" aria-label={asset + ' 策略盈虧與歷史'} onClose={close}>
    <header className="v37-heading"><div><h2>{asset} 策略盈虧與歷史</h2></div>
     <button className="v37-button" type="button" onClick={close}>關閉</button></header>
    {open && <Details key={asset} asset={asset} ledger={ledger} notional={notional}/>}
   </dialog>
   {noticeLog}
  </> : <>
   {noticeLog}
   <div className="v37-tabs" role="group" aria-label="策略商品">{ASSETS.map(item => <button className="v37-button" key={item}
    type="button" aria-pressed={selectedAsset === item} onClick={() => select(item)}>{item}</button>)}</div>
   <Details key={selectedAsset} asset={selectedAsset} ledger={ledger} notional={notional}/>
  </>}
 </section>;
}
