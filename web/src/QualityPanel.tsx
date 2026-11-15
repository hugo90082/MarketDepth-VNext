import {useMemo} from 'react';
import {Waves,RefreshCw} from 'lucide-react';
import {ageAt,type Asset,type Venue,VENUES,VENUE_NAMES} from '../shared/model';
import {assessHistory} from './history-quality';
import {time} from './format';
import {LocalCapacity} from './LocalCapacity';
import {MarketHistoryStatus} from './market-history/Status';
import type {useMarkets} from './runtime/ResearchProvider';
type Props={market:ReturnType<typeof useMarkets>;asset:Asset;venue:Venue;zones:number[];label:string;now:number};
export function QualityPanel({market,asset,venue,zones,label,now}:Props){
 const tick=Math.floor(now/30000);
 const quality=useMemo(()=>assessHistory(market.rows,market.range.from,market.range.to,asset,venue,zones,market.comparison,market.verifiedBlocks),[market.rows,asset,venue,zones,market.comparison,market.verifiedBlocks,tick]);
 const age=ageAt(market.recent?.payload.meta.dataAgeMs??null,market.recent?.at??null,now),stale=age===null||age>60000;
 const action=market.manualAction,comparing=action.phase==='starting';
 const venueLabel=venue==='all4'?'ALL4':VENUE_NAMES[VENUES.indexOf(venue)];
 return <section className="quality-panel"><div className="panel-heading"><div><h2>資料品質與備份</h2></div><Waves size={16}/></div><div className="quality-scope">{asset} · {venueLabel} · {label}</div><dl><div><dt>資料來源</dt><dd>{market.source==='railway'||market.source==='recent'?'VNext 主機與雲端封存':'瀏覽器即時採樣'}</dd></div><div><dt>最新採樣</dt><dd>{time(market.recent?.payload.meta.latestTargetTsMs)}</dd></div><div><dt>資料年齡</dt><dd className={stale ? 'ask-text' : ''}>{age === null ? '—' : `${Math.floor(age / 1000)} 秒`} <i className={`tiny-dot ${stale ? 'warning' : ''}`}/></dd></div><div><dt>所選區間可用</dt><dd>{quality.available}<span> / {quality.expected} 格</span></dd></div><div><dt>深度完整／部分／未知</dt><dd>{quality.fullCoverage} / {quality.partialCoverage} / {quality.unknownCoverage}<span> 格</span></dd></div></dl>{(action.message||market.historyError)&&<div className="manual-progress" role={action.phase==='error'?'alert':'status'}>{action.message||market.historyError}</div>}<div className="quality-foot"><RefreshCw size={13} className={comparing?'spin':''}/><button className="compare-button" onClick={()=>market.compare({asset,venue,zones})} disabled={comparing}>{comparing?'正在從 VNext 同步區間歷史…':'重新同步 VNext 區間歷史'}</button></div><LocalCapacity/><MarketHistoryStatus/></section>;
}
