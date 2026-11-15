import {useLayoutEffect,useRef,useState} from 'react';
import type {IChartApi,ISeriesApi,MouseEventParams,Time} from 'lightweight-charts';
import type {Asset,Candle,Venue} from '../../shared/model';
import {supportedProfile,formatLargeAmount,largeOrderThreshold,type ProfileFrame,type ProfileMarket,type ProfileMode} from '../../shared/order-book-profile';
import {marketRuntime} from '../runtime/client';
import {ProfilePrimitive} from './ProfilePrimitive';
import {time,qty} from '../format';

type Props={api:{chart:IChartApi;series:ISeriesApi<'Candlestick'>}|null;asset:Asset;venue:Venue;latest?:Candle;priceAt?:number;onWidth:(width:number)=>void;market:ProfileMarket;enabled:boolean;compact?:boolean};
const names={binance:'Binance',coinbase:'Coinbase'};
const duration=(at:number|null,now:number)=>at===null?'未知':Math.max(0,Math.floor((now-at)/1000))+' 秒';
const staleFrame=(frame:ProfileFrame):ProfileFrame=>({...frame,max:0,levels:[],sources:frame.sources.map(s=>({...s,available:false,phase:'摘要延遲'})),totals:frame.totals.map(t=>({...t,bid:null,ask:null,bidCount:null,askCount:null,bidShare:null,bidComplete:false,askComplete:false}))});
export function OrderBookProfile({api,asset,venue,latest,priceAt,onWidth,market,enabled,compact=false}:Props){
 const [storedFrame,setFrame]=useState<ProfileFrame|null>(null),[capable,setCapable]=useState(marketRuntime.profileCapability),[now,setNow]=useState(Date.now),[tipPrice,setTip]=useState<number|null>(null);
 const selection=useRef({market,venue});selection.current={market,venue};
 const control=useRef<{select:()=>void;source:()=>void}|null>(null),callback=useRef(onWidth);callback.current=onWidth;
 const active=enabled&&(market==='usdm'||supportedProfile(venue));
 const frame=storedFrame?.asset===asset&&(storedFrame.market??'spot')===market&&(market==='usdm'||storedFrame.mode===venue)?storedFrame:null;
 // Primitive ownership is independent of the selected exchange and market.
 useLayoutEffect(()=>{
  setFrame(null);setTip(null);if(!api||!enabled)return;
  let disposed=false,revision=0,lastViewport='',queued='',window:{low:number;high:number;height:number}|null=null,timer:ReturnType<typeof setTimeout>|undefined,current:ProfileFrame|null=null;
  const key=crypto.randomUUID(),subscriptions=new Map<ProfileMarket,{id:string;revision:number;mode:ProfileMode;window:string}>();
  const cache=new Map<string,{window:string;frame:ProfileFrame}>();
  const cacheKey=(m:ProfileMarket,mode:ProfileMode)=>m+':'+mode;
  const display=()=>{
   const {market:m,venue:v}=selection.current,mode=m==='usdm'?'binance':v;
   const entry=cache.get(cacheKey(m,mode as ProfileMode));
   current=entry?.window===lastViewport?entry.frame:null;
   if(current&&Date.now()-current.sampleAt>60000)current=staleFrame(current);
   setFrame(current);setNow(Date.now());p.set(current,false,140);
  };
  const request=(m:ProfileMarket,mode:ProfileMode)=>{
   if(!window||document.hidden)return;
   const old=subscriptions.get(m);if(old?.mode===mode&&old.window===lastViewport)return;
   const next=++revision,id=marketRuntime.profileDemand(key+':'+m,{revision:next,asset,market:m,mode,...window});
   subscriptions.set(m,{id,revision:next,mode,window:lastViewport});
  };
  const source=()=>{
   const v=selection.current.venue;
   if(supportedProfile(v))request('spot',v);
   else if(subscriptions.has('spot')){marketRuntime.profileDemand(key+':spot',null);subscriptions.delete('spot');}
   if(selection.current.market==='spot')display();
  };
  const view=(low:number,high:number,height:number)=>{
   if(disposed||document.hidden)return;const signature=[low.toFixed(8),high.toFixed(8),Math.round(height)].join(':');
   if(signature===lastViewport||signature===queued)return;queued=signature;clearTimeout(timer);
   timer=setTimeout(()=>{lastViewport=signature;queued='';window={low,high,height};cache.clear();request('usdm','binance');const v=selection.current.venue;if(supportedProfile(v))request('spot',v);},200);
  };
  const p=new ProfilePrimitive(api.chart,api.series,view);api.chart.panes()[0].attachPrimitive(p);control.current={select:display,source};
  const event=marketRuntime.events(message=>{
   if(disposed)return;
   if(message.type==='profile-capability'){setCapable(message.capable);cache.clear();current=null;setFrame(null);setTip(null);p.set(null,false,140);return;}
   // Inactive source caches must also lose validity during a real resynchronization.
   if(message.type==='book-status'&&message.state?.symbol===asset&&['initializing','reconnecting','error','unsupported'].includes(message.state.phase)){
    const state=message.state,m=(state.market??'spot') as ProfileMarket,s=String(state.exchange).toLowerCase();
    if(s==='binance'||s==='coinbase'){cache.delete(cacheKey(m,s));if(m==='spot')cache.delete(cacheKey(m,'all4'));if(m===selection.current.market&&(m==='usdm'||selection.current.venue===s||selection.current.venue==='all4'))display();}
    return;
   }
   const m=(message.market??'spot') as ProfileMarket,sub=subscriptions.get(m);
   if(message.type!=='profile-frame'||!sub||message.id!==sub.id||message.revision!==sub.revision||message.asset!==asset||message.mode!==sub.mode||document.hidden)return;
   cache.set(cacheKey(m,sub.mode),{window:sub.window,frame:message as ProfileFrame});if(m===selection.current.market)display();
  });
  const move=(e:MouseEventParams<Time>)=>{const size=api.chart.paneSize(0);if(e.paneIndex!==0||!e.point||e.point.x<size.width-148){setTip(null);return;}setTip(p.priceAt(e.point.y));};api.chart.subscribeCrosshairMove(move);
  const removeDemands=()=>{for(const m of subscriptions.keys())marketRuntime.profileDemand(key+':'+m,null);subscriptions.clear();};
  const visibility=()=>{clearTimeout(timer);queued='';cache.clear();current=null;setFrame(null);setTip(null);p.set(null,false,140);removeDemands();if(!document.hidden){lastViewport='';window=null;p.updateAllViews();setNow(Date.now());}};
  const observer=new ResizeObserver(()=>p.updateAllViews());observer.observe(api.chart.chartElement());
  const clock=setInterval(()=>{if(document.hidden)return;setNow(Date.now());if(current&&Date.now()-current.sampleAt>60000){current=staleFrame(current);setFrame(current);p.set(current,false,140);}},1000);
  document.addEventListener('visibilitychange',visibility);p.updateAllViews();
  return()=>{disposed=true;control.current=null;clearTimeout(timer);clearInterval(clock);event();observer.disconnect();document.removeEventListener('visibilitychange',visibility);removeDemands();api.chart.unsubscribeCrosshairMove(move);try{api.chart.panes()[0]?.detachPrimitive(p);}catch{/* chart already disposed */}};
 },[api,asset,enabled]);
 useLayoutEffect(()=>{control.current?.source();setTip(null);},[venue]);
 useLayoutEffect(()=>{control.current?.select();setTip(null);},[market]);
 useLayoutEffect(()=>{callback.current(api&&active?140:0);},[active,api]);
 if(!enabled)return null;
 const available=frame?.sources.filter(s=>s.available).length??0,total=market==='spot'&&venue==='all4'?2:1,updated=Math.max(0,...(frame?.sources??[]).map(s=>s.updateAt));
 const tip=tipPrice===null?null:frame?.levels.reduce<(NonNullable<typeof frame>['levels'][number])|null>((best,l)=>!best||Math.abs(l.price-tipPrice)<Math.abs(best.price-tipPrice)?l:best,null);
 const inTip=tip&&api&&tipPrice!==null&&Math.abs((api.series.priceToCoordinate(tip.price)??Infinity)-(api.series.priceToCoordinate(tipPrice)??0))<=6?tip:null;
 const supported=market==='usdm'||supportedProfile(venue),title=market==='usdm'?'Binance USDT 永續':venue==='all4'?'Binance＋Coinbase':names[venue as keyof typeof names];
 const reasons=!supported?'Kraken／Bitfinex 現貨大額掛單尚未支援。':capable===false?'主控分頁為舊版本，請重新整理兩頁。':!frame?'掛單準備中。':!available?'掛單來源暫不可用 · 最後更新 '+(updated?time(updated):'—'):'';
 const sourceTip=(frame?.sources??[]).map(s=>names[s.source]+'：'+s.phase+'；中間價 '+qty(s.mid)+'；與永續價差 '+(s.mid!==null&&latest?qty(s.mid-latest.c):'—')+'；活動 '+(s.activityAt?time(s.activityAt):'—')+'；掛單更新 '+(s.updateAt?time(s.updateAt):'—')).join('\n');
 const details=title+' · '+available+'/'+total+'；計算 '+(frame?time(frame.sampleAt):'—')+'；門檻 '+formatLargeAmount(largeOrderThreshold(asset))+'；最新永續 '+qty(latest?.c)+'（'+(priceAt?time(priceAt):'—')+'）\n'+sourceTip+'\n同價位合計，非個別委託。'+(market==='usdm'?'USDT 名目金額、不乘槓桿，一般簿不含 RPI。':'USD／USDT 依 1：1 計算。');
 return <div className={'order-profile'+(compact?' compact-profile':'')} data-profile-market={market} data-profile-source={market==='usdm'?'binance':venue} data-profile-sample={frame?.sampleAt??''} data-profile-levels={frame?.levels.length??0}>
  {reasons&&<div className="profile-inline-status" role="status" title={details}>{reasons}</div>}
  {inTip&&frame&&<div className="profile-tooltip" role="status"><b>價位 {qty(inTip.price)}</b><span>買 {qty(inTip.bid)} · 賣 {qty(inTip.ask)} · 計算 {time(frame.sampleAt)}</span>{Object.entries(inTip.parts).map(([source,v])=><span key={source}><b>{names[source as keyof typeof names]}</b>：買 {qty(v!.bid)}／賣 {qty(v!.ask)} · 本次已觀測時間 買 {v!.bid?duration(v!.bidObservedAt,now):'—'}／賣 {v!.ask?duration(v!.askObservedAt,now):'—'} · {v!.bidComplete&&v!.askComplete?'已確認':'部分覆蓋'}</span>)}<small>同價位合計；密集處以同像素最大金額繪製代表。歷史十字線搭配最新掛單。</small></div>}
 </div>;
}
