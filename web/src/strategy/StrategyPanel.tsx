import {useEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react';
import {ASSETS, type Asset} from '../../shared/model';
import {floating, HOUR, NOTIONAL, remaining, type ClosedEpisode, type Fill, type Strategy} from '../../shared/strategy-v37';
import {LANES, portfolioDrawdowns, shownStates, summarizeAsset, type AssetPnlSummary, type DrawdownEpisode, type Lane, type LaneDefinition, type Ledger, type Notice} from '../../shared/strategy-v37-ledger';
import {marketRuntime} from '../runtime/client';
import {dateTime} from '../format';
import {strategyRuntime, type ResetHorizon} from './runtime';
import {MAX_NOTICES, readHistory, type HistoryCursor} from './store';
import './strategy.css';

const money = new Intl.NumberFormat('zh-TW', {minimumFractionDigits:2, maximumFractionDigits:2});
const priceFmt = new Intl.NumberFormat('zh-TW', {minimumFractionDigits:2, maximumFractionDigits:2});
const units = new Intl.NumberFormat('zh-TW', {maximumFractionDigits:3});
const actions: Record<Fill['kind'], string> = {entry:'進場', add:'加碼', trim:'回零減碼 75%', reverse:'反向全平', stop:'停損', expiry:'到期'};
const timestamp = (at: number) => dateTime(at);
const sideName = (side: 1 | -1) => side === 1 ? '多方' : '空方';
const tone = (value: number | null) => value === null || Math.abs(value) < 1e-9 ? '' : value > 0 ? 'v37-positive' : 'v37-negative';
const signed = (value: number | null, scale: number) => value === null ? '—' : (value > 0 ? '+' : '') + money.format(value * scale);

function netText(amount: number) {
 if (!amount) return '零部位';
 return (amount > 0 ? '淨多 ' : '淨空 ') + units.format(Math.abs(amount) / NOTIONAL) + 'N';
}
function netBadgeClass(amount: number) {
 return amount > 0 ? 'v37-net-long' : amount < 0 ? 'v37-net-short' : 'v37-net-flat';
}

function useStrategy() {
 return useSyncExternalStore(strategyRuntime.subscribe, strategyRuntime.snapshot);
}

export function StrategyToasts() {
 const {toast} = useStrategy();
 if (!toast.length) return null;
 return <div className="v37-toast" role="status">{toast.map(notice => {
  const isLong = notice.side === 1;
  return <div key={notice.id} className={isLong ? 'v37-toast-long' : 'v37-toast-short'}>
   <div><b>V37 {notice.asset} {sideName(notice.side)} · {actions[notice.action]}</b></div>
   <div><span>{notice.zone} bps（{notice.threshold.toFixed(2)} · {notice.entryRule}/{notice.addRule}）· {units.format(notice.amount / NOTIONAL)}N @ {priceFmt.format(notice.price)}</span></div>
  </div>;
 })}</div>;
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
  <span>1N</span><input type="number" step="any" inputMode="decimal" value={draft}
   onChange={event => setDraft(event.currentTarget.value)}
   onBlur={event => setDraft(String(strategyRuntime.setNotional(event.currentTarget.valueAsNumber)))}
   onKeyDown={event => {if (event.key === 'Enter') event.currentTarget.blur();}}/>
 </label>;
}

function ResetControl({resetting}: {resetting: boolean}) {
 const [horizon, setHorizon] = useState<ResetHorizon>('all');
 const isLeader = marketRuntime.isLeader();
 return <div className="v37-reset-group" title="重設觀測起算時間與清空現有策略帳本並重新演算（歷史區間需起算點前 15 小時連續 K 線暖機）">
  <select className="v37-select" aria-label="選擇重設起算點" value={String(horizon)} onChange={e => {
   const v = e.currentTarget.value;
   setHorizon(v === 'all' ? 'all' : Number(v));
  }}>
   <option value="all">有資料以來（自動）</option>
   <option value="0">從現在起算</option>
   <option value="8">最近 8 小時</option>
   <option value="24">最近 24 小時</option>
   <option value="72">最近 3 天</option>
   <option value="168">最近 7 天</option>
  </select>
  <button type="button" className="v37-button" disabled={resetting || !isLeader}
   title={!isLeader ? '請在主控分頁操作重設' : '依所選起算點清除並重算所有策略'}
   onClick={() => {void strategyRuntime.reset(horizon);}}>
   {resetting ? '重算中…' : '重設起算'}
  </button>
 </div>;
}

function TimelineBar({ledger, summaries, catchingUp}: {ledger: Ledger | null; summaries: AssetPnlSummary[]; catchingUp?: boolean}) {
 const readyTimes = summaries.map(s => s.firstReadyAt).filter((x): x is number => x !== null);
 const firstReadyAt = readyTimes.length ? Math.min(...readyTimes) : (ledger?.firstReadyAt ?? null);
 const confirmedTimes = summaries.map(s => s.confirmedThrough).filter((x): x is number => x !== null);
 const confirmedThrough = confirmedTimes.length ? Math.min(...confirmedTimes) : null;
 const availableLanes = summaries.reduce((s, x) => s + x.availableLanes, 0);
 const longCount = summaries.reduce((s, x) => s + x.longCount, 0);
 const shortCount = summaries.reduce((s, x) => s + x.shortCount, 0);
 return <div className="v37-timeline-bar">
  <div className="v37-timeline-item"><span>起算基準</span><b>{ledger ? timestamp(ledger.from) : '初始化中'}</b></div>
  <div className="v37-timeline-item"><span>首筆就緒</span><b>{firstReadyAt ? timestamp(firstReadyAt) : '暖機中（需起算前 15h K 線）'}</b></div>
  <div className="v37-timeline-item"><span>確認至</span><b>{confirmedThrough ? timestamp(confirmedThrough) : '等待資料'}{catchingUp ? ' · 背景回算中…' : ''}</b></div>
  <div className="v37-timeline-item"><span>連線區間</span><b>{availableLanes} / 15 區</b></div>
  <div className="v37-timeline-item"><span>持倉統計</span><b>多 {longCount} / 空 {shortCount} 支</b></div>
 </div>;
}

function PortfolioStrip({summaries, scale, ledger}: {summaries: AssetPnlSummary[]; scale: number; ledger: Ledger | null}) {
 const started = summaries.some(s => s.startedLanes > 0);
 const longTotal = summaries.reduce((s, x) => s + x.longNotional, 0);
 const shortTotal = summaries.reduce((s, x) => s + x.shortNotional, 0);
 const netGross = summaries.reduce((s, x) => s + Math.abs(x.net), 0);
 const realized = summaries.reduce((s, x) => s + x.realized, 0);
 const hasUnrealized = summaries.some(s => s.unrealized !== null);
 const unrealized = hasUnrealized ? summaries.reduce((s, x) => s + (x.unrealized ?? 0), 0) : null;
 const total = started ? realized + (unrealized ?? 0) : null;
 const drawdowns = portfolioDrawdowns(ledger);
 const curve = ledger?.portfolio;
 const currentDrawdown = curve && curve.through !== null ? Math.max(0, curve.peak - curve.eq) : null;
 const drawdownBox = (label: string, episode: DrawdownEpisode | undefined) => <div className="v37-stat-box"
  title={episode
   ? `高點 ${timestamp(episode.peakAt)} → 谷底 ${timestamp(episode.troughAt)}${episode.endAt === null ? '，尚未回到前高' : `，於 ${timestamp(episode.endAt)} 回到前高`}。以每分鐘收盤標記計算（含預估平倉費）；目前距前高 ${currentDrawdown === null ? '—' : money.format(currentDrawdown * scale)} USD`
   : curve && curve.through !== null ? '尚無回撤紀錄' : '等待全部區間就緒後計算'}>
  <span>{label}</span>
  <strong className={episode ? 'v37-negative' : ''}>{episode ? '-' + money.format(episode.depth * scale) + ' USD' : '—'}</strong>
  {episode && <small>{dateTime(episode.peakAt)} → {dateTime(episode.troughAt)}{episode.endAt === null ? ' · 未回復' : ''}</small>}
 </div>;
 return <div className="v37-portfolio-strip" aria-label="全商品策略組合彙總">
  <div className="v37-stat-box"><span>虛擬多方總名目</span><strong className="v37-long-text">{money.format(longTotal * scale)} USD</strong></div>
  <div className="v37-stat-box"><span>虛擬空方總名目</span><strong className="v37-short-text">{money.format(shortTotal * scale)} USD</strong></div>
  <div className="v37-stat-box"><span>抵銷後淨毛曝險</span><strong>{money.format(netGross * scale)} USD</strong></div>
  <div className="v37-stat-box"><span>總已實現盈虧</span><strong className={tone(started ? realized : null)}>{signed(started ? realized : null, scale)} USD</strong></div>
  <div className="v37-stat-box" title="未平倉持倉依最新合約標記價估算，已扣除預估平倉 4 bps 費用"><span>總未實現盈虧</span><strong className={tone(unrealized)}>{signed(unrealized, scale)} USD</strong></div>
  <div className="v37-stat-box"><span>組合總盈虧</span><strong className={tone(total)}>{signed(total, scale)} USD</strong></div>
  {drawdownBox('組合最大回撤', drawdowns[0])}
  {drawdownBox('組合第二大回撤', drawdowns[1])}
 </div>;
}

function SummaryCard({summary, scale, replaying}: {summary: AssetPnlSummary; scale: number; replaying: boolean}) {
 const ready = summary.startedLanes > 0;
 const status = summary.oldestGap
  ? `等待${summary.oldestGap.reason === 'price' ? '價格' : '深度'} ${timestamp(summary.oldestGap.at)} · 待回補`
  : replaying
   ? '正在回算已保存行情…'
   : summary.availableLanes < 5
    ? '暖機中（需起算前 15h K 線與 15m 連續深度）'
    : null;
 return <div className="v37-summary">
  <div className="v37-summary-title">
   <b>{summary.asset}</b>
   <span className={'v37-net-badge ' + netBadgeClass(summary.net)}>{ready ? netText(summary.net) : '暖機中'}</span>
   <span>{summary.availableLanes}／5 區</span>
  </div>
  <div className="v37-side-split">
   <div className="v37-box-long">
    <span>虛擬多方 ({summary.longCount} 支)</span>
    <strong>+{units.format(summary.longNotional / NOTIONAL)}N</strong>
    <small>{money.format(summary.longNotional * scale)} USD</small>
   </div>
   <div className="v37-box-short">
    <span>虛擬空方 ({summary.shortCount} 支)</span>
    <strong>-{units.format(summary.shortNotional / NOTIONAL)}N</strong>
    <small>{money.format(summary.shortNotional * scale)} USD</small>
   </div>
  </div>
  <div className="v37-pnl-grid">
   <div className="v37-pnl-cell" title="已結束回合淨利加上持倉中減碼與手續費入帳">
    <span>已實現</span>
    <strong className={tone(ready ? summary.realized : null)}>{signed(ready ? summary.realized : null, scale)}</strong>
   </div>
   <div className="v37-pnl-cell" title={summary.markAt ? `依 ${timestamp(summary.markAt)} 價格 ${priceFmt.format(summary.markPrice ?? 0)} 計算（含預估平倉費）` : '等待標記價'}>
    <span>未實現{summary.markAt && !summary.markFresh ? '*' : ''}</span>
    <strong className={tone(summary.unrealized)}>{signed(summary.unrealized, scale)}</strong>
   </div>
   <div className="v37-pnl-cell" title="已實現＋未實現總盈虧">
    <span>總盈虧</span>
    <strong className={tone(summary.total)}>{signed(summary.total, scale)}</strong>
   </div>
  </div>
  <div className="v37-summary-meta">
   <span>{summary.firstReadyAt ? `首筆就緒 ${timestamp(summary.firstReadyAt)}` : '尚未就緒'}</span>
   <span>{summary.markAt ? `標記 ${timestamp(summary.markAt)}` : ''}</span>
  </div>
  {status && <p>{status}</p>}
 </div>;
}

function FillTable({fills, scale}: {fills: Fill[]; scale: number}) {
 return <div className="v37-scroll"><table className="v37-table v37-fills">
  <thead><tr>{['成交時間','動作','份額','代理價','名目 USD','費用 USD','入帳 USD'].map(text => <th key={text} scope="col">{text}</th>)}</tr></thead>
  <tbody>{fills.map((fill, index) => <tr key={index}>
   <td>{timestamp(fill.at)}</td><td>{actions[fill.kind]}</td><td>{fill.lot}</td>
   <td>{priceFmt.format(fill.price)}</td><td>{money.format(fill.amount * scale)}</td><td>{money.format(fill.fee * scale)}</td>
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
 return <div>
  <h4>歷史已結束回合</h4>
  {error ? <button className="v37-button" type="button" onClick={() => load()}>歷史讀取失敗，重試</button> : null}
  {!rounds.length && <p>{loading ? '讀取本機歷史…' : '尚無已結束回合'}</p>}
  {rounds.map(round => <details key={round.id} className="v37-round">
   <summary>
    <span>{timestamp(round.startedAt)} → {timestamp(round.closedAt)}</span>
    <span>{actions[round.reason]}{round.provisional ? ' · 待回補對帳' : ''}（{round.fills.length} 筆）</span>
    <b className={tone(round.cash)}>{signed(round.cash, scale)} USD</b>
   </summary>
   <FillTable fills={round.fills} scale={scale}/>
  </details>)}
  {cursor && <button type="button" className="v37-button" disabled={loading} onClick={() => load(cursor)}>{loading ? '讀取中…' : '載入較舊回合'}</button>}
 </div>;
}

function StrategyCard({strategy, lane, index, markPrice, historyVersion, scale}: {
 strategy: Strategy;
 lane: Lane | undefined;
 index: number;
 markPrice: number | null;
 historyVersion: number;
 scale: number;
}) {
 const [expanded, setExpanded] = useState(false);
 const state = lane ? shownStates(lane)[index] : undefined;
 const confirmed = lane?.states[index];
 const current = state?.episode ?? null;
 const rem = remaining(current);
 const isOpen = rem > 0;
 const isStopped = !!state?.stopped && !isOpen;
 const closedPnl = confirmed?.closedPnl ?? 0;
 const closedCount = confirmed?.closedCount ?? 0;
 const realized = closedPnl + (current?.cash ?? 0);
 const unrealized = current && markPrice !== null ? floating(current, strategy.side, markPrice) : (isOpen ? null : (lane?.through != null ? 0 : null));
 const total = lane?.through != null ? (unrealized !== null ? realized + unrealized : realized) : null;
 const drawdown = lane?.dd?.[index];
 const pendingAct = state?.pending[0];
 const statusPill = isOpen
  ? <span className={strategy.side === 1 ? 'v37-pill v37-pill-long' : 'v37-pill v37-pill-short'}>
     持倉 {units.format(rem / NOTIONAL)}N{current?.trimmed ? ' (已減碼)' : ''}
    </span>
  : isStopped
   ? <span className="v37-pill v37-pill-warn">停損冷卻</span>
   : <span className="v37-pill v37-pill-idle">空倉</span>;

 return <details className={`v37-strat-card ${strategy.side === 1 ? 'v37-card-long' : 'v37-card-short'}${isOpen ? ' is-open' : ''}`}
  onToggle={e => setExpanded(e.currentTarget.open)}>
  <summary className="v37-strat-summary">
   <div className="v37-strat-head">
    <div className="v37-strat-id">
     <span className={strategy.side === 1 ? 'v37-pill v37-pill-long' : 'v37-pill v37-pill-short'}>{sideName(strategy.side)}</span>
     <code>{strategy.threshold.toFixed(2)}</code>
     <span>{strategy.entry}/{strategy.add}（上限 {strategy.maxLots}N）</span>
    </div>
    {statusPill}
   </div>
   <div className="v37-strat-metrics">
    <div><span>已實現 USD</span><b className={tone(lane?.through != null ? realized : null)}>{signed(lane?.through != null ? realized : null, scale)}</b></div>
    <div><span>未實現 USD</span><b className={tone(unrealized)}>{signed(unrealized, scale)}</b></div>
    <div><span>總計 USD</span><b className={tone(total)}>{signed(total, scale)}</b></div>
    <div><span>結束回合</span><b>{lane?.through != null ? closedCount : '—'}</b></div>
    <div title={drawdown && drawdown.maxAt !== null ? `高點 ${timestamp(drawdown.maxPeakAt ?? drawdown.maxAt)} → 谷底 ${timestamp(drawdown.maxAt)}；以每分鐘收盤標記計算` : '尚無回撤'}>
     <span>最大回撤 USD</span><b className={drawdown && drawdown.max > 0 ? 'v37-negative' : ''}>{drawdown ? (drawdown.max > 0 ? '-' : '') + money.format(drawdown.max * scale) : '—'}</b>
    </div>
   </div>
  </summary>
  {expanded && <div className="v37-strat-body">
   <div className="v37-meta">
    <span>策略代號：{strategy.id}</span>
    {pendingAct && <span>排程下根開盤：{actions[pendingAct.kind]} @ {timestamp(pendingAct.at)}</span>}
   </div>
   <h4>目前回合進出場明細{current ? `（起算 ${timestamp(current.startedAt)} · 本回已入帳 ${signed(current.cash, scale)} USD）` : ''}</h4>
   {current ? <FillTable fills={current.fills} scale={scale}/> : <p>目前空倉{isStopped ? '（觸及停損，等待後續 15m 訊號歸零解鎖）' : ''}</p>}
   <RoundHistory key={strategy.id} strategy={strategy} version={historyVersion} scale={scale}/>
  </div>}
 </details>;
}

type StrategyFilter = 'all' | 'active' | 'traded' | 'long' | 'short';

function ZoneGroup({
 def, lane, markPrice, historyVersions, scale, filter, compact,
}: {
 def: LaneDefinition;
 lane: Lane | undefined;
 markPrice: number | null;
 historyVersions: Record<string, number>;
 scale: number;
 filter: StrategyFilter;
 compact?: boolean;
}) {
 const states = lane ? shownStates(lane) : null;
 const confirmed = lane?.states;
 const zoneLimit = def.key.split(':')[1];
 const thresholds = useMemo(() => [...new Set(def.strategies.map(item => item.threshold))].sort((a, b) => a - b), [def.strategies]);

 let zoneOpen = 0, zoneTotalPnl = 0;
 const matchingThresholds = thresholds.filter(threshold => def.strategies.some((s, idx) => {
  if (s.threshold !== threshold) return false;
  const st = states?.[idx], cf = confirmed?.[idx];
  const hasOpen = !!(st?.episode && remaining(st.episode) > 0);
  const hasTrades = (st?.episode?.fills.length ?? 0) > 0 || (cf?.closedCount ?? 0) > 0;
  if (filter === 'active') return hasOpen;
  if (filter === 'traded') return hasTrades;
  if (filter === 'long') return s.side === 1;
  if (filter === 'short') return s.side === -1;
  return true;
 }));

 for (let i = 0; i < def.strategies.length; i++) {
  const s = def.strategies[i], st = states?.[i], cf = confirmed?.[i];
  if (st?.episode && remaining(st.episode) > 0) zoneOpen++;
  zoneTotalPnl += (cf?.closedPnl ?? 0) + (st?.episode?.cash ?? 0);
  if (st?.episode && markPrice !== null) zoneTotalPnl += floating(st.episode, s.side, markPrice);
 }

 const [open, setOpen] = useState(!compact || zoneOpen > 0);
 useEffect(() => {
  if (filter !== 'all' || zoneOpen > 0) setOpen(true);
 }, [filter, zoneOpen]);

 if (!matchingThresholds.length) return null;

 return <details className="v37-zone-group" open={open} onToggle={e => setOpen(e.currentTarget.open)}>
  <summary className="v37-zone-summary">
   <div className="v37-zone-title">
    <strong>0–{zoneLimit} bps</strong>
    <span>{def.strategies.length} 支策略</span>
    {lane?.quality && lane.quality !== 'complete' && <span className="v37-pill v37-pill-warn">{lane.quality === 'partial' ? '部分覆蓋' : '品質未知'}</span>}
    {lane?.gap && <span className="v37-pill v37-pill-warn">等待回補</span>}
   </div>
   <div className="v37-zone-stats">
    <span>持倉 {zoneOpen}</span>
    <b className={tone(lane?.through != null ? zoneTotalPnl : null)}>{signed(lane?.through != null ? zoneTotalPnl : null, scale)} USD</b>
   </div>
  </summary>
  <div className="v37-pair-grid">
   {matchingThresholds.map(threshold => {
    const longIdx = def.strategies.findIndex(s => s.side === 1 && s.threshold === threshold);
    const shortIdx = def.strategies.findIndex(s => s.side === -1 && s.threshold === threshold);
    const showLong = longIdx >= 0 && filter !== 'short' && (
     filter === 'all' || filter === 'long' ||
     (filter === 'active' && !!(states?.[longIdx]?.episode && remaining(states[longIdx].episode) > 0)) ||
     (filter === 'traded' && ((states?.[longIdx]?.episode?.fills.length ?? 0) > 0 || (confirmed?.[longIdx]?.closedCount ?? 0) > 0))
    );
    const showShort = shortIdx >= 0 && filter !== 'long' && (
     filter === 'all' || filter === 'short' ||
     (filter === 'active' && !!(states?.[shortIdx]?.episode && remaining(states[shortIdx].episode) > 0)) ||
     (filter === 'traded' && ((states?.[shortIdx]?.episode?.fills.length ?? 0) > 0 || (confirmed?.[shortIdx]?.closedCount ?? 0) > 0))
    );
    return <div key={threshold} className="v37-pair-row">
     {showLong && <StrategyCard strategy={def.strategies[longIdx]} lane={lane} index={longIdx}
      markPrice={markPrice} historyVersion={historyVersions[def.strategies[longIdx].id] ?? 0} scale={scale}/>}
     {showShort && <StrategyCard strategy={def.strategies[shortIdx]} lane={lane} index={shortIdx}
      markPrice={markPrice} historyVersion={historyVersions[def.strategies[shortIdx].id] ?? 0} scale={scale}/>}
    </div>;
   })}
  </div>
 </details>;
}

function Details({asset, ledger, notional, compact}: {asset: Asset; ledger: Ledger | null; notional: number; compact?: boolean}) {
 const scale = notional / NOTIONAL;
 const [filter, setFilter] = useState<StrategyFilter>('all');
 const definitions = useMemo(() => LANES.filter(lane => lane.asset === asset), [asset]);
 const mark = ledger?.marks[asset];

 const counts = useMemo(() => {
  let total = 0, active = 0, traded = 0, long = 0, short = 0;
  for (const def of definitions) {
   const lane = ledger?.lanes[def.key];
   const states = lane ? shownStates(lane) : null;
   for (let i = 0; i < def.strategies.length; i++) {
    const s = def.strategies[i];
    total++;
    if (s.side === 1) long++; else short++;
    const st = states?.[i], cf = lane?.states[i];
    if (st?.episode && remaining(st.episode) > 0) active++;
    if ((st?.episode?.fills.length ?? 0) > 0 || (cf?.closedCount ?? 0) > 0) traded++;
   }
  }
  return {total, active, traded, long, short};
 }, [definitions, ledger]);

 const filters: {key: StrategyFilter; label: string}[] = [
  {key:'all', label:`全部 (${counts.total})`},
  {key:'active', label:`持倉中 (${counts.active})`},
  {key:'traded', label:`有進出場 (${counts.traded})`},
  {key:'long', label:`多方 (${counts.long})`},
  {key:'short', label:`空方 (${counts.short})`},
 ];

 return <div className="v37-detail">
  <div className="v37-meta">
   <span>1N＝{notional.toLocaleString('zh-TW', {maximumSignificantDigits:21})} USD · 代理成交 · 單邊費用 4 bps</span>
   <span>有效標記價 {mark ? `${priceFmt.format(mark.price)} (${timestamp(mark.at)})` : '—'}{mark && !mark.fresh ? ' · 待更新' : ''}</span>
  </div>
  <div className="v37-toolbar">
   <div className="v37-filter-group" role="group" aria-label="策略篩選">
    {filters.map(f => <button key={f.key} type="button" className="v37-button" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>{f.label}</button>)}
   </div>
  </div>
  <div className="v37-zones-list">
   {definitions.map((def: LaneDefinition) => <ZoneGroup key={def.key} def={def} lane={ledger?.lanes[def.key]}
    markPrice={mark?.price ?? null} historyVersions={ledger?.historyVersions ?? {}} scale={scale} filter={filter} compact={compact}/>)}
   {filter === 'active' && counts.active === 0 && <p className="v37-message">目前沒有持倉中的策略，點擊上方「全部」查看全部 {counts.total} 支策略。</p>}
   {filter === 'traded' && counts.traded === 0 && <p className="v37-message">本觀測區間尚無已執行的進出場紀錄。</p>}
  </div>
 </div>;
}

type NoticeFilter = 'all' | 'open' | 'close';

function NoticeLog({notices, asset, scale}: {notices: Notice[]; asset?: Asset; scale: number}) {
 const [filter, setFilter] = useState<NoticeFilter>('all');
 const [expanded, setExpanded] = useState(false);
 const byAsset = notices.filter(notice => !asset || notice.asset === asset);
 const cutoff = Date.now() - HOUR;
 const recent = byAsset.filter(notice => notice.fillAt >= cutoff);
 const scoped = expanded ? byAsset : recent;
 const filtered = scoped.filter(notice => {
  if (filter === 'open') return notice.action === 'entry' || notice.action === 'add';
  if (filter === 'close') return notice.action !== 'entry' && notice.action !== 'add';
  return true;
 });
 return <section className={'v37-notices' + (expanded ? ' is-expanded' : '')} aria-label="提醒紀錄">
  <div className="v37-notices-head">
   <span className="v37-notices-title">
    <span>提醒紀錄（僅實際進出場觸發）</span>
    <span className="v37-notices-count">最近 1 小時 {recent.length} 筆 · 已存 {byAsset.length}／{MAX_NOTICES} 筆</span>
   </span>
   {byAsset.length > 0 && <button type="button" className="v37-button" aria-expanded={expanded} onClick={() => setExpanded(v => !v)}>
    {expanded ? '收合至最近 1 小時' : `展開完整（${byAsset.length} 筆）`}
   </button>}
  </div>
  {byAsset.length > 0 && <div className="v37-notice-filters" role="group" aria-label="提醒篩選">
   <button type="button" className="v37-button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
    {expanded ? `全部 (${byAsset.length})` : `最近 1h (${recent.length})`}
   </button>
   <button type="button" className="v37-button" aria-pressed={filter === 'open'} onClick={() => setFilter('open')}>進場／加碼</button>
   <button type="button" className="v37-button" aria-pressed={filter === 'close'} onClick={() => setFilter('close')}>出場／停損</button>
  </div>}
  <ul>{filtered.map(notice => {
   const isLong = notice.side === 1;
   const isClose = notice.action !== 'entry' && notice.action !== 'add';
   return <li key={notice.id} className={isLong ? 'v37-notice-long' : 'v37-notice-short'}>
    <div className="v37-notice-top">
     <time>{timestamp(notice.fillAt)}</time>
     <span className={isLong ? 'v37-pill v37-pill-long' : 'v37-pill v37-pill-short'}>{notice.asset} {sideName(notice.side)}</span>
     <span className={notice.action === 'stop' ? 'v37-pill v37-pill-warn' : 'v37-pill v37-pill-act'}>{actions[notice.action]}</span>
     <strong>{notice.zone} bps · {notice.threshold.toFixed(2)} ({notice.entryRule}/{notice.addRule})</strong>
     {notice.provisional && <span className="v37-pill v37-pill-warn">待回補對帳</span>}
    </div>
    <div className="v37-notice-sub">
     <span>{units.format(notice.amount / NOTIONAL)}N @ {priceFmt.format(notice.price)}（手續費 {money.format(notice.fee * scale)} USD）</span>
     <span>
      {isClose && <><b className={tone(notice.cash)}>{signed(notice.cash, scale)} USD</b> · </>}
      淨額 {netText(notice.netBefore)} → {netText(notice.netAfter)}
     </span>
    </div>
   </li>;
  })}</ul>
  {!filtered.length && <p className="v37-message">
   {!expanded && byAsset.length > 0
    ? `最近 1 小時內尚無符合條件的進出場提醒（完整歷史共 ${byAsset.length} 筆，可點擊「展開完整」檢視）。`
    : '尚無進出場提醒，實際進場、加碼、減碼或出場時才會記錄並提醒。'}
  </p>}
 </section>;
}

export function StrategyPanel({asset}: {asset?: Asset}) {
 const {ledger, notices, error, capable, notional, resetting, catchingUp} = useStrategy();
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
 const scale = notional / NOTIONAL;
 const summaries = useMemo(() => ASSETS.map(a => summarizeAsset(a, ledger)), [ledger]);
 const currentSummary = asset ? summaries.find(s => s.asset === asset)! : null;

 return <section className={'v37-panel' + (asset ? ' v37-sidebar' : '')} aria-label="V37 策略觀測">
  <header className="v37-heading">
   <div><h2>V37 策略觀測</h2><span>108 支策略 · 1m 出場</span></div>
   <div className="v37-controls">
    <NotionalControl notional={notional}/>
    <SoundControl/>
    <ResetControl resetting={resetting}/>
   </div>
  </header>
  {error && <p role="status" className="v37-message">{error}</p>}
  {capable === false && <p role="status" className="v37-message">請重新整理目前負責收集行情的分頁，以啟用策略。</p>}
  <TimelineBar ledger={ledger} summaries={summaries} catchingUp={catchingUp}/>
  {!asset && <PortfolioStrip summaries={summaries} scale={scale} ledger={ledger}/>}
  <div className="v37-summaries">
   {(asset ? [currentSummary!] : summaries).map(s => <SummaryCard key={s.asset} summary={s} scale={scale} replaying={!!ledger?.replay}/>)}
  </div>
  <NoticeLog notices={notices} asset={asset} scale={scale}/>
  {asset ? <>
   <div className="v37-sidebar-actions">
    <button ref={trigger} type="button" className="v37-button" onClick={() => setOpen(true)}>放大檢視全部策略與總覽</button>
   </div>
   <Details key={asset} asset={asset} ledger={ledger} notional={notional} compact/>
   <dialog ref={dialog} className="v37-dialog" aria-label={asset + ' 策略盈虧與歷史'} onClose={close}>
    <header className="v37-heading">
     <div><h2>V37 全覽 · {asset} 策略盈虧與進出場明細</h2></div>
     <button className="v37-button" type="button" onClick={close}>關閉</button>
    </header>
    {open && <>
     <TimelineBar ledger={ledger} summaries={summaries} catchingUp={catchingUp}/>
     <PortfolioStrip summaries={summaries} scale={scale} ledger={ledger}/>
     <div className="v37-tabs" role="group" aria-label="策略商品" style={{padding:'6px 8px 0'}}>
      {ASSETS.map(item => <button className="v37-button" key={item} type="button"
       aria-pressed={selectedAsset === item} onClick={() => select(item)}>{item}</button>)}
     </div>
     <Details key={selectedAsset} asset={selectedAsset} ledger={ledger} notional={notional}/>
    </>}
   </dialog>
  </> : <>
   <div className="v37-tabs" role="group" aria-label="策略商品" style={{padding:'6px 8px 0'}}>
    {ASSETS.map(item => <button className="v37-button" key={item} type="button"
     aria-pressed={selectedAsset === item} onClick={() => select(item)}>{item}</button>)}
   </div>
   <Details key={selectedAsset} asset={selectedAsset} ledger={ledger} notional={notional}/>
  </>}
 </section>;
}
