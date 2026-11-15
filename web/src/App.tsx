import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Activity, ArrowDownRight, ArrowUpRight, ArrowUpRight as External, CircleHelp, Database, RefreshCw, ShieldCheck } from 'lucide-react';
import { ageAt, ASSETS, depth, VENUES, VENUE_NAMES, ZONES, type Asset, type Venue } from '../shared/model';
import { Charts } from './Charts';
import { StrategyPanel } from './strategy/StrategyPanel';
import {IndicatorPanel} from './indicators/IndicatorPanel';
import {useIndicatorSettings,useIndicatorColors} from './indicators/settings';
import {ControlPopover} from './ControlPopover';
import {QualityPanel} from './QualityPanel';
import { ErrorBoundary } from './ErrorBoundary';
import { compact, dateTime, percent, ratio, qty, time } from './format';
import { useMarkets } from './runtime/ResearchProvider';
import {ChartSync} from './profile/chart-sync';
import type {ProfileMarket} from '../shared/order-book-profile';
import { barWidths, type Interval } from '../shared/contract';
import { assessHistory } from './history-quality';
import { priceWindowChange,commonChartTimeline } from '../shared/chart-data';
import {RESEARCH_RANGES,defaultInterval,rangeLabel} from '../shared/minute-history';
function DepthBars({bid,ask,className='depth-bar'}:{bid:number|null;ask:number|null;className?:string}){const widths=barWidths(bid,ask);return <div className={className+(bid===null||ask===null?' unknown':'')} aria-label={bid===null||ask===null?'覆蓋不足，買賣占比未知':`買方 ${widths[0].toFixed(1)}%，賣方 ${widths[1].toFixed(1)}%`}><span className="bid-bar" style={{width:widths[0]+'%'}}/><span className="ask-bar" style={{width:widths[1]+'%'}}/></div>;}

const ranges = RESEARCH_RANGES;
const intervals = [[60000,'1 分'],[300000,'5 分'],[900000,'15 分'],[3600000,'1H'],[14400000,'4H'],[43200000,'12H']] as const;
const zoneChoices = [
  ...ZONES.map((b, i) => ({ key: `z${i}`, label: `${b[0]}–${b[1]}`, zones: [i], group: '獨立區間' })),
  ...[1, 2, 3, 4].map(i => ({ key: `c${i}`, label: `0–${ZONES[i][1]}`, zones: Array.from({ length: i + 1 }, (_, j) => j), group: '累積區間' })),
];
function StateDot({ good, label }: { good: boolean; label: string }) { return <span className={`state-dot ${good ? 'good' : 'warn'}`}><i/>{label}</span>; }
export function App({navigation}:{navigation?:ReactNode}) {
  const [asset, setAsset] = useState<Asset>(()=>ASSETS.find(a=>a===sessionStorage.getItem('research-asset'))??'BTC'), [venue, setVenue] = useState<Venue>(()=>[...VENUES,'all4' as const].find(v=>v===sessionStorage.getItem('research-venue'))??'all4');
  const [zoneKey, setZoneKey] = useState(()=>zoneChoices.find(z=>z.key===sessionStorage.getItem('research-zone'))?.key??'c2'), [hours, setHours] = useState(()=>ranges.find(h=>h===Number(sessionStorage.getItem('research-hours')))??24), [now, setNow] = useState(Date.now());
  const [info, setInfo] = useState(false);
  const [secondaryZoneKey,setSecondaryZoneKey]=useState(()=>zoneChoices.find(z=>z.key===sessionStorage.getItem('research-zone-secondary'))?.key??'c4');
  const [openControl,setOpenControl]=useState<'quality'|'depth'|null>(null);
  const [qualityAsset,setQualityAsset]=useState<Asset>(asset),[qualityIndicator,setQualityIndicator]=useState(0);
  const toggleControl=(name:'quality'|'depth')=>setOpenControl(current=>current===name?null:name);
  useEffect(()=>{sessionStorage.setItem('research-zone-secondary',secondaryZoneKey);},[secondaryZoneKey]);
  const [integrated,setIntegrated]=useState(()=>sessionStorage.getItem('research-view')==='integrated');
  const [profileMarket,setProfileMarket]=useState<ProfileMarket>(()=>sessionStorage.getItem('research-profile-market')==='spot'?'spot':'usdm'),[profileEnabled,setProfileEnabled]=useState(()=>sessionStorage.getItem('research-profile-enabled')!=='0');
  const [chartSync]=useState(()=>new ChartSync());
  const [autoAdvance,setAutoAdvance]=useState(()=>sessionStorage.getItem('research-auto-advance')!=='0');
  useEffect(()=>{sessionStorage.setItem('research-auto-advance',autoAdvance?'1':'0');},[autoAdvance]);
  useEffect(()=>{sessionStorage.setItem('research-view',integrated?'integrated':asset);sessionStorage.setItem('research-profile-market',profileMarket);sessionStorage.setItem('research-profile-enabled',profileEnabled?'1':'0');},[integrated,asset,profileMarket,profileEnabled]);
  const [interval,setIntervalValue]=useState<Interval>(()=>intervals.find(([i])=>i===Number(sessionStorage.getItem('research-interval')))?.[0]??60000);
  useEffect(() => { const tick = () => setNow(Date.now()); const timer = setInterval(tick, 1000); document.addEventListener('visibilitychange', tick); return () => { clearInterval(timer); document.removeEventListener('visibilitychange', tick); }; }, []);
  const indicators=useIndicatorSettings(),bandColors=useIndicatorColors();
  const engine=useMarkets(integrated?ASSETS:[asset],hours,interval,venue,[zoneChoices.find(z=>z.key===zoneKey)!.zones,zoneChoices.find(z=>z.key===secondaryZoneKey)!.zones]),market={...engine,...engine.assetViews[asset]};
  const timelineStart=Math.min(Math.floor(engine.range.from/interval)*interval,...ASSETS.map(a=>engine.assetViews[a].candles[0]?.t??Infinity)),timelineEnd=Math.floor(engine.range.to/interval)*interval;
  const timeline=useMemo(()=>integrated?commonChartTimeline(timelineStart,timelineEnd,interval):undefined,[integrated,timelineStart,timelineEnd,interval]);
  useEffect(()=>{sessionStorage.setItem('research-asset',asset);sessionStorage.setItem('research-hours',String(hours));sessionStorage.setItem('research-venue',venue);sessionStorage.setItem('research-zone',zoneKey);sessionStorage.setItem('research-interval',String(interval));},[asset,hours,venue,zoneKey,interval]);
  const zone = zoneChoices.find(z => z.key === zoneKey)!;
  const secondaryZone=zoneChoices.find(z=>z.key===secondaryZoneKey)!;
  const depthLabel=(z:typeof zone)=>z.label+' bps'+(z.group==='累積區間'?' 累積':'');
  // An all-null target is an explicit data-quality record, not permission to
  // keep showing an older non-null row as the current market summary.
  const latest = market.rows.at(-1);
  const value = depth(latest, asset, venue, zone.zones);
  const age = ageAt(market.recent?.payload.meta.dataAgeMs ?? null, market.recent?.at ?? null, now);
  const stale = age === null || age > 60_000;
  const currentIssues=(market.rows.at(-1)?.issues??[]).filter(issue=>issue.startsWith(asset+' '));
  const offline = currentIssues.length>0;
  const phases={initializing:'初始化中',reconnecting:'重連中',ready:'正常',late:'取樣延遲',error:'連線失敗',unsupported:'不支援'};
  const sourceIssues=Object.values(market.connections).filter(s=>s.symbol===asset&&s.phase!=='ready').map(s=>s.exchange+'：'+phases[s.phase]+(s.reason?'（'+s.reason+'）':''));
  const priceAge = ageAt(market.price?.payload.meta.ageMs ?? null, market.price?.at ?? null, now);
  const priceStale = priceAge === null || priceAge > 60_000;
  const lastCandle = market.candles.at(-1), firstCandle = market.candles[0];
  const priceWindowReady=!!firstCandle&&firstCandle.t<=Math.ceil(market.range.from/interval)*interval;
  const priceChange = priceWindowChange(market.candles,market.range.from,interval);
  const priceHistoryTip=`K 線最早 ${firstCandle?dateTime(firstCandle.t):'尚無資料'}；${priceWindowReady?'已涵蓋所選區間起點':'所選區間起點尚無 K 線，不計算區間漲跌幅'}`;
  const h = market.history?.meta;
  const qualityTick=Math.floor(now/30_000);
  const quality=useMemo(()=>assessHistory(market.rows,market.range.from,market.range.to,asset,venue,zone.zones,market.comparison,market.verifiedBlocks),
   [market.rows,asset,venue,zone,hours,market.comparison,market.verifiedBlocks,qualityTick]);
  const comparing=!!market.manual&&!market.manual.job.complete;
  const venueRows = VENUES.map((v, i) => {const q=latest?.quality?.books[i]?.[ASSETS.indexOf(asset)];return { venue: v, name: VENUE_NAMES[i], quality:q, partial:!!q&&zone.zones.some(z=>!q.complete[z]), ...depth(latest, asset, v, zone.zones) };});
  const scope = venue === 'all4' ? 'ALL4' : VENUE_NAMES[VENUES.indexOf(venue)];
  const binanceCoverage=market.coverage[asset];
  const coverageText=binanceCoverage&&now-binanceCoverage.at<=45000 ? 'Binance 快照確認範圍：買方 '+binanceCoverage.bidBps.toFixed(1)+'／賣方 '+binanceCoverage.askBps.toFixed(1)+' bps；'+(binanceCoverage.coverageMode==='sequenced-diff'?'連續 Diff 已觀測範圍：買方 '+(binanceCoverage.observedBidBps??binanceCoverage.bidBps).toFixed(1)+'／賣方 '+(binanceCoverage.observedAskBps??binanceCoverage.askBps).toFixed(1)+' bps。所有已取得掛單均參與計算；補快照保留序號連續的外側掛單。':'REST5000 初始化中。')+'前端來源與 Railway 歷史分別保留取得方式；已封存歷史保留 Railway 原值（包含 null）。' : '';
  const ratioTone = value.ratio === null ? '' : value.ratio >= 0 ? 'bid-text' : 'ask-text';
  const connectionIssues = [offline ? '部分現貨行情連線中斷' : '', stale ? age===null?'現貨行情連線中':'現貨資料延遲 '+Math.floor(age/1000)+' 秒' : '', market.errors.price||priceStale?'永續合約價格待更新':'', market.errors.history ? market.historyError|| (h?.connection.state==='unauthorized'?'歷史授權需更新，已停止重試':'歷史連線異常，依等待時間重試') : '', market.storageError,currentIssues.join('；'),...sourceIssues].filter(Boolean);
  const connectionDetails=connectionIssues.length?connectionIssues.join('；'):'行情連線正常 · 現貨資料年齡 '+Math.floor((age??0)/1000)+' 秒';
  return <div className={"terminal research-page"+(integrated?" integrated-page":"")}>
    <header className="site-header"><a className="brand" href="/" aria-label="MarketDepth 首頁"><span className="brand-mark"><i/><i/><i/><i/></span><strong>MARKET<span>DEPTH</span></strong></a><nav className="header-controls" aria-label="資產切換"><div className="asset-tabs">{ASSETS.map((a,i)=><button key={a} className={a===asset&&!integrated?'active':''} aria-pressed={a===asset&&!integrated} onClick={()=>{setIntegrated(false);setAsset(a);}}><span className={`coin coin-${a.toLowerCase()}`}>{['₿','Ξ','◎'][i]}</span><b>{a}</b></button>)}<button className={integrated?'active':''} aria-pressed={integrated} onClick={()=>setIntegrated(true)}><b>整合K線</b></button></div></nav><div className="header-right">{navigation}<span className="connection-status" tabIndex={0} aria-label={connectionDetails}><StateDot good={!connectionIssues.length} label={connectionIssues.length?'連線異常':'連線正常'}/><span className="connection-tooltip" role="tooltip">{connectionDetails}</span></span><span className="clock">{time(now)} <small>UTC+8</small></span><button className="help-button" aria-label="資料說明" aria-expanded={info} onClick={()=>setInfo(x=>!x)}><CircleHelp size={17}/></button></div></header>
    <div className="market-controls" aria-label="觀察設定"><div className="range-selector"><span>觀察區間</span><div className="segmented">{ranges.map(r=><button key={r} aria-pressed={hours===r} className={hours===r?'active':''} onClick={()=>{setHours(r);setIntervalValue(defaultInterval(r));}}>{rangeLabel(r)}</button>)}</div></div><div className="venue-pills" role="group" aria-label="圖表交易所"><button className={venue === 'all4' ? 'active' : ''} aria-pressed={venue === 'all4'} onClick={() => setVenue('all4')}>ALL4 <small>可用來源</small></button>{VENUES.map((v, i) => <button key={v} className={venue === v ? 'active' : ''} aria-pressed={venue === v} onClick={() => setVenue(v)}>{VENUE_NAMES[i]}</button>)}</div><div className="interval-toolbar"><span>K 線週期</span><div className="segmented">{intervals.map(([v,label])=><button key={v} aria-pressed={interval===v} className={interval===v?'active':''} onClick={()=>setIntervalValue(v)}>{label}</button>)}</div></div><div className="profile-toolbar"><ControlPopover label="資料品質" open={openControl==='quality'} onToggle={()=>toggleControl('quality')} onClose={()=>setOpenControl(null)} className="quality-control"><div className="quality-selectors">{integrated&&<label>商品<select aria-label="品質商品" value={qualityAsset} onChange={e=>setQualityAsset(e.target.value as Asset)}>{ASSETS.map(a=><option key={a}>{a}</option>)}</select></label>}<label>指標<select aria-label="品質指標" value={qualityIndicator} onChange={e=>setQualityIndicator(Number(e.target.value))}><option value={0}>指標一</option><option value={1}>指標二</option></select></label></div><QualityPanel market={engine} asset={integrated?qualityAsset:asset} venue={venue} zones={qualityIndicator===0?zone.zones:secondaryZone.zones} label={(qualityIndicator===0?'指標一 · ':'指標二 · ')+depthLabel(qualityIndicator===0?zone:secondaryZone)} now={now}/></ControlPopover><div className="profile-market" role="group" aria-label="掛單市場"><button type="button" aria-pressed={profileMarket==='usdm'} onClick={()=>setProfileMarket('usdm')}>幣安合約</button><button type="button" aria-pressed={profileMarket==='spot'} onClick={()=>setProfileMarket('spot')}>現貨</button></div><label><input type="checkbox" checked={profileEnabled} onChange={e=>setProfileEnabled(e.target.checked)}/>大額掛單</label></div><ControlPopover label="指標設定" open={openControl==='depth'} onToggle={()=>toggleControl('depth')} onClose={()=>setOpenControl(null)} className="indicator-control"><IndicatorPanel asset={integrated?'BTC':asset}>{[zoneKey,secondaryZoneKey].map((key,i)=><label className="indicator-select" key={i}><span>指標{i===0?'一':'二'}</span><select value={key} aria-label={i===0?'指標一深度':'指標二深度'} onChange={e=>(i===0?setZoneKey:setSecondaryZoneKey)(e.target.value)}>{['獨立區間','累積區間'].map(group=><optgroup key={group} label={group}>{zoneChoices.filter(z=>z.group===group).map(z=><option key={z.key} value={z.key}>{depthLabel(z)}</option>)}</optgroup>)}</select></label>)}</IndicatorPanel></ControlPopover></div>
    <main>{integrated?<section className="integrated-workspace" aria-label="BTC ETH SOL 整合K線">{ASSETS.map(a=><section className="chart-panel integrated-chart" key={a}><ErrorBoundary key={a+'-'+hours} label={a+' 圖表暫時無法顯示'}><Charts interval={interval} key={a+'-'+hours} rows={engine.rows} candles={engine.assetViews[a].candles} asset={a} venue={venue} zones={zone.zones} secondaryZones={secondaryZone.zones} zoneLabel={depthLabel(zone)} secondaryZoneLabel={depthLabel(secondaryZone)} from={engine.range.from} to={engine.range.to} hours={hours} priceAt={engine.assetViews[a].priceObservedAt} profileMarket={profileMarket} profileEnabled={profileEnabled} indicators={indicators[a]} bandColors={bandColors[a].bandColors} autoAdvance={autoAdvance} onAutoAdvanceChange={setAutoAdvance} compact sync={chartSync} timeline={timeline}/></ErrorBoundary></section>)}</section>:<>
      {info && <section className="info-banner"><CircleHelp size={18}/><div><strong>讀懂這個畫面</strong><p>深度為各交易所現貨訂單簿，單位是 USD；USD 與 USDT 依 1：1 計算，不換匯。價格為 Binance USDⓈ-M 永續合約。失衡 = (Bid − Ask) ÷ (Bid + Ask)。ALL4 加總可用交易所的買賣量，至少一家有效即可計算；缺值不當作零，部分深度保留覆蓋標示。策略區提供虛擬部位與淨額提醒。</p></div><button onClick={() => setInfo(false)}>關閉</button></section>}
      <section className="summary-strip" aria-label="市場摘要">
       <div className="summary-price summary-tip" tabIndex={0} data-tip={priceHistoryTip+'；'+rangeLabel(hours)+' 區間變化'+(priceStale?' · 價格待更新':lastCandle&&!lastCandle.closed?' · 未收盤':lastCandle&&!lastCandle.complete?' · 資料不完整':'')}><span>永續合約價格 <small>USDT</small></span><div className="summary-price-values"><strong>{qty(lastCandle?.c)}</strong><span className={priceChange !== null && priceChange < 0 ? 'ask-text' : 'bid-text'}>{priceChange !== null && (priceChange >= 0 ? <ArrowUpRight size={12}/> : <ArrowDownRight size={12}/>)}{percent(priceChange)}</span></div></div>
       {(['bid','ask'] as const).map(side=><div key={side} className="summary-tip" tabIndex={0} data-tip={scope+' · '+depthLabel(zone)+(value[side]===null?' · 所需資料不足':'')}><div className="summary-heading"><span>{side==='bid'?'買方':'賣方'}掛單 <i className={'legend-dot '+side}/></span><small>{scope} · {zone.label} bps</small></div><strong className={side+'-text'}>{compact(value[side])} <small>USD</small></strong></div>)}
       <div className="imbalance-summary summary-tip" tabIndex={0} data-tip={value.ratio===null?'所需資料不完整或總量為零':value.ratio>0?'買方掛單較多':value.ratio<0?'賣方掛單較多':'買賣掛單均衡'}><span>掛單失衡 <Activity size={13}/></span><strong className={ratioTone}>{ratio(value.ratio)}</strong><div className="imbalance-meter"><i style={{left: `${value.ratio===null?50:50+value.ratio*48}%`,opacity:value.ratio===null?0:1}}/></div></div>
       <div className="zones-grid">{ZONES.map((z,i)=>{const d=depth(latest,asset,venue,[i]);return <button key={i} className={`zone-card ${zoneKey===`z${i}`?'selected':''}`} onClick={()=>setZoneKey(`z${i}`)} aria-pressed={zoneKey===`z${i}`} aria-label={`${z[0]}–${z[1]} bps · 失衡 ${ratio(d.ratio)}`}><div className="zone-heading"><strong>{z[0]}–{z[1]} <small>bps</small></strong><b className={d.ratio===null?'muted':d.ratio>=0?'bid-text':'ask-text'}>{ratio(d.ratio)}</b></div><DepthBars className="zone-balance" bid={d.bid} ask={d.ask}/><div className="zone-numbers"><span className="bid-text">{compact(d.bid)}</span><span className="ask-text">{compact(d.ask)}</span></div></button>;})}</div>
      </section>
      <div className="workspace"><section className="chart-panel"><ErrorBoundary key={`${asset}-${hours}`} label="圖表暫時無法顯示"><Charts interval={interval} key={`${asset}-${hours}`} rows={market.rows} candles={market.candles} asset={asset} venue={venue} zones={zone.zones} secondaryZones={secondaryZone.zones} zoneLabel={depthLabel(zone)} secondaryZoneLabel={depthLabel(secondaryZone)} from={market.range.from} to={market.range.to} hours={hours} priceAt={market.priceObservedAt} profileMarket={profileMarket} profileEnabled={profileEnabled} indicators={indicators[asset]} bandColors={bandColors[asset].bandColors} autoAdvance={autoAdvance} onAutoAdvanceChange={setAutoAdvance}/></ErrorBoundary>
        <div className="history-progress" role="status"><Database size={13}/><span>{comparing&&h?.connection.state==='error'?'封存歷史等待來源恢復':comparing?`歷史比對中 · ${h?.loadedChunks??0} / ${h?.totalChunks??0} 個區塊`:quality.unverified?`封存歷史待手動比對 · ${quality.unverified} 格`:quality.checkedAt?'封存歷史已核對':'瀏覽器保存 · 封存歷史可手動比對'}</span>{comparing&&h&&<progress value={h.loadedChunks} max={h.totalChunks || 1}/>}<span className="history-range">{market.rows.length ? `${dateTime(market.rows[0].t)} 起` : '等待資料'}{quality.outsideRetention?' · 部分時間無後端歷史':''}</span></div>
      </section>
      <aside className="sidebar"><section className="venue-panel"><div className="panel-heading"><div><h2>交易所深度</h2></div><span className="small-mono">{zone.label} bps</span></div><div className="venue-table-head"><span>交易所 / USD</span><span>買方 / 賣方 · 比值</span></div>{venueRows.map((v, i) => <div className="venue-row" key={v.venue} title={i===0?coverageText:undefined}><div className="venue-row-title"><span><i className={`venue-marker venue-${i}`}/><b>{v.name}</b></span><span className={v.ratio === null ? 'muted' : v.ratio >= 0 ? 'bid-text' : 'ask-text'}><span className="ratio-caption">比值 </span>{ratio(v.ratio)}</span></div><div className="venue-quantities"><span className="bid-text">{qty(v.bid)}</span><span className="ask-text">{qty(v.ask)}</span></div><DepthBars bid={v.bid} ask={v.ask}/>{v.partial&&v.bid!==null&&v.ask!==null&&<small className="missing-label">{i===0&&v.quality?.coverageMode==='sequenced-diff'?`連續 Diff 累積 · 觀測買 ${(v.quality.observedBidBps??v.quality.bidBps).toFixed(0)}／賣 ${(v.quality.observedAskBps??v.quality.askBps).toFixed(0)} bps`:'部分覆蓋 · 僅計入已取得掛單'}</small>}{(v.bid === null || v.ask === null) && <small className="missing-label">{i===0&&coverageText?'覆蓋不足 · ':''}{v.bid === null ? '買方缺值' : ''}{v.bid === null && v.ask === null ? ' / ' : ''}{v.ask === null ? '賣方缺值' : ''}</small>}</div>)}<div className="strict-note"><ShieldCheck size={15}/><span><b>ALL4 可用來源</b> 部分深度依實際取得量計算</span><strong>{value.fullVenues===3?'DEGRADED ':''}{value.fullVenues}<small>/4</small></strong></div></section>

      <StrategyPanel asset={asset}/></aside></div>

    </>}{integrated&&<StrategyPanel/>}</main>{!integrated&&<footer><div><span className="footer-mark">MD.</span><span>觀察深度，保留真實。<small>唯讀市場資料 · 無下單功能</small></span></div><div><a href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer nofollow">Charts by TradingView <External size={11}/></a><button onClick={market.refresh} disabled={market.busy}><RefreshCw size={12} className={market.busy ? 'spin' : ''}/>重新整理</button><span className="footer-version">V3.0</span></div></footer>}
  </div>;
}



