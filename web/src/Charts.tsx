import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { chartCandles, candleChange, commonChartTimeline, depthRatioBuckets, visibleLogicalRange } from '../shared/chart-data';
import { CandlestickSeries, ColorType, CrosshairMode, HistogramSeries, LineSeries, LineStyle, TickMarkType, createChart, type IChartApi, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts';
import { LocateFixed } from 'lucide-react';
import { type Asset, type Candle, type SpotRow, type Venue } from '../shared/model';
import { dateTime, ratio as formatRatio, qty, time } from './format';

import type { Interval } from '../shared/contract';
import {OrderBookProfile} from './profile/OrderBookProfile';
import {profileVisibleRange} from './profile/layout';
import type {ProfileMarket} from '../shared/order-book-profile';
import type {ChartSync} from './profile/chart-sync';
import {ViewportClock,moveViewport} from './profile/viewport-clock';
import {integratedPaneLayout,indicatorPaneLayout,fixedPaneBaseline} from '../shared/pane-layout';
import {bandPrice,defaultIndicators,type IndicatorSettings,type IndicatorPoint} from '../shared/technical-indicators';
import {indicatorClient,type IndicatorResult} from './indicators/client';
import {RsiBands} from './indicators/RsiBands';
import {DEFAULT_BAND_COLORS} from '../shared/indicator-preferences';
interface Props { interval: Interval; rows: SpotRow[]; candles: Candle[]; asset: Asset; venue: Venue; zones: number[]; secondaryZones?:number[]; zoneLabel?:string; secondaryZoneLabel?:string; from: number; to: number; hours: number; priceAt?:number;profileMarket:ProfileMarket;profileEnabled:boolean;compact?:boolean;sync?:ChartSync;timeline?:number[];indicators?:IndicatorSettings;bandColors?:string[];autoAdvance?:boolean;onAutoAdvanceChange?:(enabled:boolean)=>void }
const stamp = (ms: number) => (ms / 1000) as UTCTimestamp;
const RIGHT_PADDING_BARS = 10;
const SECONDARY_ZONES = [0,1,2,3,4];
const DEFAULT_INDICATORS=defaultIndicators(),RSI_TICKS=[30,50,70];
const RATIO_GUIDES=[{price:-0.6,color:'#ffff00'},{price:-0.4,color:'#d6b36d'},{price:-0.2,color:'#69c4d4'},{price:0,color:'#a9bac2'},{price:0.2,color:'#69c4d4'},{price:0.4,color:'#d6b36d'},{price:0.6,color:'#ffff00'}];
type Series = { candle: ISeriesApi<'Candlestick'>; ratio: ISeriesApi<'Histogram'>; ratio2: ISeriesApi<'Histogram'>; grid:ISeriesApi<'Line'>;average:ISeriesApi<'Line'>[];rsi?:ISeriesApi<'Line'> };

export const Charts = memo(function Charts(props: Props) {
  const node = useRef<HTMLDivElement>(null), chart = useRef<IChartApi | null>(null), series = useRef<Series | null>(null);
  const axisNode=useRef<HTMLDivElement>(null);
  const settings=props.indicators??DEFAULT_INDICATORS,settingsRef=useRef(settings);settingsRef.current=settings;
  const indicatorId=useRef(crypto.randomUUID()),indicatorPoints=useRef(new Map<number,IndicatorPoint>()),indicatorKey=useRef('');
  const [technical,setTechnical]=useState({value:null as number|null,status:'',error:''});
  const technicalLayout=useRef<()=>void>(()=>{}),plotTechnical=useRef<(reset:boolean,points:IndicatorPoint[])=>void>(()=>{});
  const firstRange = useRef(false), followingLive = useRef(true), previousCandles=useRef<Candle[]>([]);
  const clock=useRef(new ViewportClock()),gridState=useRef<{from:number;to:number;interval:number}|null>(null);
  const autoAdvance=props.autoAdvance??true;
  const candleContext=useRef('');
  const candles=useMemo(()=>chartCandles(props.candles),[props.candles]);
  const hasCandles=candles.length>0;
  const gridFrom=props.timeline?.[0]!==undefined?props.timeline[0]*1000:Math.min(Math.floor(props.from/props.interval)*props.interval,candles[0]?.t??Infinity);
  const gridTo=props.timeline?.at(-1)!==undefined?props.timeline.at(-1)!*1000:Math.floor(props.to/props.interval)*props.interval;
  const liveSlot=Math.floor(props.to/props.interval)*props.interval;
  const bucketFrom=Math.floor(props.from/60000)*60000,bucketTo=Math.floor(props.to/60000)*60000;
  const buckets=useMemo(()=>depthRatioBuckets(props.rows,props.asset,props.venue,props.zones,props.interval,bucketFrom,bucketTo),[props.rows,props.asset,props.venue,props.zones,props.interval,bucketFrom,bucketTo]);
  const secondaryZones=props.secondaryZones??SECONDARY_ZONES;
  const buckets2=useMemo(()=>depthRatioBuckets(props.rows,props.asset,props.venue,secondaryZones,props.interval,bucketFrom,bucketTo),[props.rows,props.asset,props.venue,secondaryZones,props.interval,bucketFrom,bucketTo]);
  const lastBuckets=useRef<{primary:typeof buckets|null;secondary:typeof buckets2|null}>({primary:null,secondary:null});
  const hasData=hasCandles||props.rows.length>0;
  const lookup=useMemo(()=>({candles:new Map(candles.map(c=>[c.t,c])),buckets:new Map(buckets.map(b=>[b.t,b.value])),buckets2:new Map(buckets2.map(b=>[b.t,b.value])),interval:props.interval}),[candles,buckets,buckets2,props.interval]);
  const values=useRef(lookup);values.current=lookup;
  const [fullScale,setFullScale]=useState(false), full=useRef(false);full.current=fullScale;
  const [hover, setHover] = useState<number | null>(null);
  const [profileApi,setProfileApi]=useState<{chart:IChartApi;series:ISeriesApi<'Candlestick'>}|null>(null),profilePadding=useRef(0);
  const setRange=(c:IChartApi)=>{const scale=c.timeScale(),range=visibleLogicalRange(props.from,props.to,t=>scale.timeToIndex(t as UTCTimestamp,true));if(!range)return false;scale.setVisibleLogicalRange(profileVisibleRange(range,c.paneSize(0).width,profilePadding.current));return true;};
  const latestSetRange=useRef(setRange);latestSetRange.current=setRange;
  const layoutRequest=useRef<number|undefined>(undefined);
  const profileWidthChanged=(width:number)=>{if(profilePadding.current===width)return;profilePadding.current=width;if(layoutRequest.current!==undefined)cancelAnimationFrame(layoutRequest.current);layoutRequest.current=requestAnimationFrame(()=>{layoutRequest.current=undefined;if(chart.current&&followingLive.current)latestSetRange.current(chart.current);});};
  useEffect(() => {
    if (!node.current) return;
    const c = createChart(node.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: '#0b151c' }, textColor: '#a9bac2', fontFamily: 'IBM Plex Mono, monospace', fontSize: 14, attributionLogo: true,
        panes: { separatorColor: '#2b3a42', separatorHoverColor: '#425661', enableResize: false } },
      grid: { vertLines: { color: '#172832' }, horzLines: { color: '#172832', style: LineStyle.Dotted } },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: '#779098', labelBackgroundColor: '#243d46' }, horzLine: { color: '#779098', labelBackgroundColor: '#243d46' } },
      rightPriceScale: { borderColor: '#2b3a42', minimumWidth: 80 },
      timeScale: { borderColor: '#2b3a42', timeVisible: true, secondsVisible: true, minBarSpacing: 0.01, rightOffset: RIGHT_PADDING_BARS, shiftVisibleRangeOnNewBar: false,
        tickMarkFormatter: (t: UTCTimestamp,type:TickMarkType) => type<=TickMarkType.DayOfMonth?dateTime(Number(t)*1000).split(' ')[0]:time(Number(t) * 1000, false) },
      localization: { timeFormatter: (t: UTCTimestamp) => props.hours>24?dateTime(Number(t)*1000):time(Number(t) * 1000) },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
    });
    const candle = c.addSeries(CandlestickSeries, { upColor: '#37d8c5', downColor: '#ff6b58', borderVisible: false, wickUpColor: '#37d8c5', wickDownColor: '#ff6b58', priceLineColor: '#a9bac2', priceLineStyle: LineStyle.Dashed,priceFormat:{type:'price',precision:props.asset==='BTC'?1:2,minMove:props.asset==='BTC'?0.1:0.01} });
    candle.priceScale().applyOptions({ scaleMargins: { top: 0.16, bottom: 0.08 } });
    const grid=c.addSeries(LineSeries,{visible:false,priceScaleId:'',lastValueVisible:false,priceLineVisible:false,crosshairMarkerVisible:false,autoscaleInfoProvider:()=>null});
    const addRatio=(pane:number)=>{
      const s=c.addSeries(HistogramSeries,{priceLineVisible:false,lastValueVisible:false,priceFormat:{type:'custom',formatter:(p:number)=>formatRatio(p),tickmarksFormatter:(prices:number[])=>prices.map(()=>''),minMove:0.001},autoscaleInfoProvider:()=>({priceRange:{minValue:full.current?-1:-0.75,maxValue:full.current?1:0.75}})},pane);
      for(const {price,color} of RATIO_GUIDES)s.createPriceLine({price,color:price===0?'#779098':Math.abs(price)===0.6?color:color+'50',lineWidth:1,lineStyle:price===0?LineStyle.Dashed:LineStyle.Solid,axisLabelVisible:false,title:''});
      s.priceScale().applyOptions({scaleMargins:{top:0,bottom:0}});return s;
    };
    const ratio=addRatio(1),ratio2=addRatio(2);
    const average=Array.from({length:7},(_,i)=>c.addSeries(LineSeries,{color:i===0?'#ffff00':(props.bandColors??DEFAULT_BAND_COLORS)[(i-1)%3],lineWidth:2,priceLineVisible:false,lastValueVisible:false,crosshairMarkerVisible:false,autoscaleInfoProvider:()=>null}));
    let rsi:ISeriesApi<'Line'>|undefined,rsiGuides:ReturnType<ISeriesApi<'Line'>['createPriceLine']>[]=[];
    let axisHover:{pane:number;y:number}|null=null;
    const updateAxes=()=>{
      if(chart.current!==c||!axisNode.current)return;
      const heights=c.panes().map(p=>p.getHeight());if(heights.length<3||heights.some(h=>h<=0))return;
      let top=32+heights[0]+1;
      axisNode.current.style.width=c.priceScale('right').width()+'px';
      [ratio,ratio2].forEach((s,i)=>{
        const height=heights[i+1];
        RATIO_GUIDES.forEach(({price},j)=>{
          const label=axisNode.current!.children[i*RATIO_GUIDES.length+j] as HTMLElement;if(!label)return;
          const y=s.priceToCoordinate(price),hidden=y===null||y<0||y>height||(axisHover?.pane===i+1&&Math.abs(axisHover.y-y)<16);
          const display=hidden?'none':'block';if(label.style.display!==display)label.style.display=display;
          if(y!==null){const next=(top+y).toFixed(2)+'px';if(label.style.top!==next)label.style.top=next;}
        });top+=height+1;
      });
      RSI_TICKS.forEach((price,i)=>{const label=axisNode.current!.children[2*RATIO_GUIDES.length+i] as HTMLElement;if(!label)return;const height=heights[3],y=rsi?.priceToCoordinate(price);label.style.display=height&&y!==null&&y!==undefined&&!(axisHover?.pane===3&&Math.abs(axisHover.y-y)<16)?'block':'none';if(height&&y!==null&&y!==undefined)label.style.top=(top+Math.max(8,Math.min(height-8,y))).toFixed(2)+'px';});
    };
    // Observe chart redraws without React state updates. Nearby ticks yield to
    // the native crosshair badge, whose precise numeric readout stays intact.
    const axisObserver={updateAllViews:updateAxes};ratio.attachPrimitive(axisObserver);
    let baseline:{height:number;panes:[number,number,number]}|null=null,measuring=false,disposed=false,lastGuides='';
    const peer={chart:c,candle,ratio,ratio2,rsi,value:(at:number,pane:number)=>{const t=Math.floor(at/values.current.interval)*values.current.interval;return pane===3?indicatorPoints.current.get(t)?.rsi??null:pane===2?values.current.buckets2.get(t)??null:pane===1?values.current.buckets.get(t)??null:values.current.candles.get(t)?.c??null;},hover:setHover,pause:()=>{followingLive.current=false;},fit:()=>{followingLive.current=true;latestSetRange.current(c);}};
    const renderPoints=(reset:boolean,points:IndicatorPoint[])=>{
      const settings=settingsRef.current,s=series.current;if(!s)return;
      const point=(p:IndicatorPoint,i:number)=>{const value=p.average===null?null:i===0?p.average:bandPrice(p.average,(i<4?settings.upper:settings.lower)[(i-1)%3].bps,i<4);return value===null?{time:stamp(p.t)}:{time:stamp(p.t),value};};
      s.average.forEach((line,i)=>{line.applyOptions({visible:i===0?settings.average.visible:(i<4?settings.upper:settings.lower)[(i-1)%3].visible});if(reset)line.setData(points.map(p=>point(p,i)));else for(const p of points)line.update(point(p,i),true);});
      if(s.rsi){const point=(p:IndicatorPoint)=>p.rsi===null?{time:stamp(p.t)}:{time:stamp(p.t),value:p.rsi,color:p.rsi>=settings.rsi.upper?'#ff6b58':p.rsi<=settings.rsi.lower?'#37d8c5':'#2962ff'};if(reset)s.rsi.setData(points.map(point));else for(const p of points)s.rsi.update(point(p),true);}
    };plotTechnical.current=renderPoints;
    const applyLayout=()=>{
      if(!baseline||disposed)return;const enabled=settingsRef.current.rsi.enabled;
      if(enabled&&!rsi){rsi=c.addSeries(LineSeries,{color:'#2962ff',lineWidth:2,priceLineVisible:false,lastValueVisible:false,priceFormat:{type:'custom',formatter:(n:number)=>n.toFixed(2),tickmarksFormatter:(p:number[])=>p.map(()=>''),minMove:.01},autoscaleInfoProvider:()=>({priceRange:{minValue:0,maxValue:100}})},3);rsi.priceScale().applyOptions({scaleMargins:{top:0,bottom:0}});rsi.attachPrimitive(new RsiBands(rsi,()=>settingsRef.current.rsi));peer.rsi=rsi;if(series.current)series.current.rsi=rsi;lastGuides='';renderPoints(true,[...indicatorPoints.current.values()]);}
      if(!enabled&&rsi){c.removeSeries(rsi);rsi=undefined;peer.rsi=undefined;if(series.current)series.current.rsi=undefined;rsiGuides=[];lastGuides='';}
      if(rsi){const key=settingsRef.current.rsi.upper+':'+settingsRef.current.rsi.lower;if(key!==lastGuides){for(const p of rsiGuides)rsi.removePriceLine(p);rsiGuides=[{price:settingsRef.current.rsi.upper,color:'#a9bac280'},{price:settingsRef.current.rsi.lower,color:'#a9bac280'},{price:85,color:'#ffff00'},{price:15,color:'#ffff00'}].map(line=>rsi!.createPriceLine({...line,lineWidth:1,lineStyle:LineStyle.Dashed,axisLabelVisible:false,title:''}));lastGuides=key;}}
      const layout=indicatorPaneLayout(baseline.height,baseline.panes,enabled);if(node.current!.style.height!==layout.height+'px')node.current!.style.height=layout.height+'px';c.panes().slice(0,layout.panes.length).forEach((p,i)=>{if(p.getStretchFactor()!==layout.panes[i])p.setStretchFactor(layout.panes[i]);});requestAnimationFrame(updateAxes);
    };technicalLayout.current=applyLayout;
    const observer=new ResizeObserver(()=>{
      if(disposed||chart.current!==c)return;if(baseline){applyLayout();return;}if(measuring)return;measuring=true;
      c.panes()[0]?.setStretchFactor(640);c.panes()[1]?.setStretchFactor(120);c.panes()[2]?.setStretchFactor(120);
      requestAnimationFrame(()=>{if(disposed)return;const panes=c.panes().slice(0,3).map(p=>p.getHeight());if(panes.length!==3||panes.some(h=>h<=0)){measuring=false;return;}const initial=props.compact?integratedPaneLayout(panes as [number,number,number]):{height:node.current!.clientHeight,panes:panes as [number,number,number]};node.current!.style.height=initial.height+'px';c.panes().slice(0,3).forEach((p,i)=>p.setStretchFactor(initial.panes[i]));requestAnimationFrame(()=>{if(disposed)return;baseline={height:initial.height,panes:fixedPaneBaseline(initial.height,c.panes().slice(0,3).map(p=>p.getHeight()) as [number,number,number],c.timeScale().height())};applyLayout();});});
    });observer.observe(node.current);
    c.subscribeCrosshairMove(e => {axisHover=e.point?{pane:e.paneIndex??0,y:e.point.y}:null;updateAxes();const at=typeof e.time==='number'?Number(e.time)*1000:null;setHover(at);if(e.sourceEvent)props.sync?.crosshair(props.asset,at,e.paneIndex??0);});
    const unregister=props.sync?.register(props.asset,peer);
    c.timeScale().subscribeVisibleLogicalRangeChange(range=>props.sync?.viewport(props.asset,range));
    // Gestures stop automatic fitting, but the display clock can still advance
    // the adjusted viewport without changing its zoom, padding or price scale.
    const pauseFollowing = () => { followingLive.current = false;props.sync?.pause(); };
    const leaveCrosshair=()=>{axisHover=null;updateAxes();setHover(null);props.sync?.crosshair(props.asset,null,0);};
    node.current.addEventListener('pointerdown', pauseFollowing);
    node.current.addEventListener('pointerleave',leaveCrosshair);
    node.current.addEventListener('wheel', pauseFollowing, { passive: true });
    chart.current = c; series.current = { candle, ratio, ratio2, grid,average };
    const disconnect=indicatorClient.connect(indicatorId.current,(result:IndicatorResult)=>{
      if(disposed)return;if(result.key!==indicatorKey.current){indicatorKey.current=result.key;indicatorPoints.current.clear();renderPoints(true,[]);setTechnical(old=>({...old,value:null}));}
      if(result.points){if(result.reset)indicatorPoints.current.clear();for(const point of result.points)indicatorPoints.current.set(point.t,point);let pruned=false;const first=previousCandles.current[0]?.t,last=previousCandles.current.at(-1)?.t;if(first!==undefined&&last!==undefined&&indicatorPoints.current.size>(last-first)/values.current.interval+513){for(const t of indicatorPoints.current.keys())if(t<first)indicatorPoints.current.delete(t);pruned=true;}renderPoints(!!result.reset||pruned,pruned?[...indicatorPoints.current.values()]:result.points);const latest=result.points.at(-1);if(latest)setTechnical(old=>({...old,value:latest.rsi}));}
      if(result.status!==undefined||result.error!==undefined)setTechnical(old=>({...old,...(result.status!==undefined?{status:result.status}:{}),...(result.error!==undefined?{error:result.error}:{})}));
    });
    setProfileApi({chart:c,series:candle});
    firstRange.current = false;
    followingLive.current = true;
    previousCandles.current=[];
    gridState.current=null;clock.current=new ViewportClock();lastBuckets.current={primary:null,secondary:null};
    const canvas = node.current;
    return () => { disposed=true;disconnect();if(layoutRequest.current!==undefined)cancelAnimationFrame(layoutRequest.current);canvas.removeEventListener('pointerdown', pauseFollowing);canvas.removeEventListener('pointerleave',leaveCrosshair); canvas.removeEventListener('wheel', pauseFollowing); observer.disconnect();unregister?.(); c.remove(); chart.current = null; series.current = null; };
  }, []);
  useEffect(()=>{
    const s=series.current,c=chart.current;if(!s||!c)return;
    const before=gridState.current,interval=props.interval,range=c.timeScale().getVisibleLogicalRange();
    if(before&&before.interval!==interval)firstRange.current=false;
    const steps=props.sync?0:clock.current.tick(liveSlot,interval,autoAdvance);
    const nextRange=!props.sync&&before?.interval===interval&&range?moveViewport(range,before.from,gridFrom,interval,steps):null;
    // Candle insertion changes the library's base index. Keep all data writes
    // inside one sync transaction, then restore/advance the adjusted viewport.
    const apply=()=>{
      if(before?.interval!==interval||before.from!==gridFrom||before.to!==gridTo){if(before?.interval===interval&&before.from===gridFrom&&before.to+interval===gridTo)s.grid.update({time:stamp(gridTo)});else s.grid.setData((props.timeline??commonChartTimeline(gridFrom,gridTo,interval)).map(time=>({time:time as UTCTimestamp})));}
      const context=props.asset+':'+interval;
      if(previousCandles.current!==candles||candleContext.current!==context){
        const change=candleContext.current===context?candleChange(previousCandles.current,candles):'all';
        const point=(x:Candle)=>({time:stamp(x.t),open:x.o,high:x.h,low:x.l,close:x.c});
        if(change==='all')s.candle.setData(candles.map(point));else if(change==='last'&&candles.length)s.candle.update(point(candles.at(-1)!));
        previousCandles.current=candles;candleContext.current=context;
        indicatorClient.update(indicatorId.current,{asset:props.asset,interval,settings:settingsRef.current,candles},change);
      }
      const points=(data:typeof buckets)=>data.map(x=>x.value===null?{time:stamp(x.t)}:{time:stamp(x.t),value:x.value,color:x.value>=0?'#37d8c5':'#ff6b58'});
      if(lastBuckets.current.primary!==buckets)s.ratio.setData(points(buckets));
      if(lastBuckets.current.secondary!==buckets2)s.ratio2.setData(points(buckets2));
      lastBuckets.current={primary:buckets,secondary:buckets2};
    };
    if(props.sync)props.sync.grid(props.asset,gridFrom,interval,apply,{at:liveSlot,enabled:autoAdvance});else apply();
    gridState.current={from:gridFrom,to:gridTo,interval};
    if(hasData&&!firstRange.current)firstRange.current=latestSetRange.current(c);
    else if(nextRange){const current=c.timeScale().getVisibleLogicalRange();if(!current||Math.abs(current.from-nextRange.from)>1e-7||Math.abs(current.to-nextRange.to)>1e-7)c.timeScale().setVisibleLogicalRange(nextRange);}
  },[gridFrom,gridTo,liveSlot,props.interval,props.asset,autoAdvance,candles,buckets,buckets2,hasData]);
  useEffect(()=>{technicalLayout.current();indicatorClient.update(indicatorId.current,{asset:props.asset,interval:props.interval,settings,candles},'all');},[settings]);
  useEffect(()=>{series.current?.average.forEach((line,i)=>{if(i)line.applyOptions({color:(props.bandColors??DEFAULT_BAND_COLORS)[(i-1)%3]});});},[props.bandColors]);
  useEffect(()=>{for(const s of [series.current?.ratio,series.current?.ratio2])s?.applyOptions({autoscaleInfoProvider:()=>({priceRange:{minValue:fullScale?-1:-0.75,maxValue:fullScale?1:0.75}})});},[fullScale]);
  const overflow=useMemo(()=>buckets.some(x=>Math.abs(x.value??0)>0.75)||buckets2.some(x=>Math.abs(x.value??0)>0.75),[buckets,buckets2]);
  const focus = hover ?? buckets.at(-1)?.t;
  const d = buckets.find(x => x.t === (focus === undefined ? undefined : Math.floor(focus / props.interval) * props.interval));
  const d2=buckets2.find(x=>x.t===(focus===undefined?undefined:Math.floor(focus/props.interval)*props.interval));
  const candle = hover === null ? props.candles.at(-1) : props.candles.find(c => c.t === Math.floor(hover / props.interval) * props.interval);
  return <div className="chart-stack">
    <div className="chart-readout" aria-live="off">{props.compact&&<b className="chart-asset-label">{props.asset}</b>}<span>{props.hours>24?dateTime(focus):time(focus)}</span><span>收 <b>{qty(candle?.c,props.asset==='BTC'?1:2)}</b></span><span title={props.zoneLabel??'0–300 bps 累積'}>指標一 <b>{formatRatio(d?.value)}</b></span><span title={props.secondaryZoneLabel??'0–750 bps 累積'}>指標二 <b>{formatRatio(d2?.value)}</b></span>{settings.rsi.enabled&&<span title={`RSI ${settings.rsi.length} · ${settings.rsi.upper}/${settings.rsi.lower}${technical.status?' · '+technical.status:''}${technical.error?' · '+technical.error:''}`}>RSI <b>{(hover===null?technical.value:indicatorPoints.current.get(Math.floor(hover/props.interval)*props.interval)?.rsi)?.toFixed(2)??'—'}</b></span>}{(technical.status||technical.error)&&<span className="indicator-status" title={technical.error||technical.status} aria-label={technical.error||technical.status}>◌</span>}</div>
    <div className="chart-canvas" ref={node} role="img" aria-label={`${props.asset} 永續合約K線、現貨深度比值同步圖表`} />
    <div className="ratio-axis-ticks" ref={axisNode} aria-hidden="true">{[1,2].flatMap(pane=>RATIO_GUIDES.map(({price,color})=><span key={pane+':'+price} data-pane={pane} data-value={price} style={{color,display:'none'}}>{formatRatio(price)}</span>))}{RSI_TICKS.map(price=><span key={'rsi:'+price} data-pane={3} data-value={price} style={{color:'#a9bac2',display:'none'}}>{price}</span>)}</div>
    <div className="pane-label price-label" style={{top:32}}>永續合約價格 <span>USDⓈ-M · {props.interval>=3600000?`${props.interval/3600000}H`:`${props.interval/60000}m`}</span></div>
    {!props.candles.length && !props.rows.length && <div className="chart-empty"><div className="loading-bars"><i/><i/><i/><i/><i/></div><strong>等待市場資料</strong><span>連線完成後，圖表將自動呈現</span></div>}
    <div className="chart-scale"><button aria-pressed={fullScale} title={overflow&&!fullScale?'部分比值超出預設範圍；十字線顯示原值':undefined} onClick={()=>setFullScale(x=>!x)}>{fullScale?'恢復 ±0.750':'查看完整 ±1.000'}</button><label className="chart-advance" title="每個 K 線週期將目前視窗向前推一格，保留縮放、留白與價格刻度；關閉可固定查看歷史"><input type="checkbox" checked={autoAdvance} onChange={e=>props.onAutoAdvanceChange?.(e.target.checked)}/>隨時間推進</label><button className="chart-latest" onClick={() => {if(props.sync)props.sync.latest();else if(chart.current&&setRange(chart.current))followingLive.current=true;}}><LocateFixed size={14}/> 回到最新</button></div>
    <OrderBookProfile api={profileApi} asset={props.asset} venue={props.venue} latest={props.candles.at(-1)} priceAt={props.priceAt} onWidth={profileWidthChanged} market={props.profileMarket} enabled={props.profileEnabled} compact={props.compact}/>
  </div>;
});

