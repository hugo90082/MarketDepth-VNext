import {ASSETS,type Asset,type Candle} from './model';
import type {Interval} from './contract';
export const INDICATOR_VERSION=1;
export const INDICATOR_INTERVALS=[60000,300000,900000,3600000,14400000,43200000] as const;
export type BandSetting={bps:number;visible:boolean};
export type IndicatorSettings={version:1;unit:'bps'|'percent';average:{kind:'MA'|'EMA'|'WMA';length:number;visible:boolean};upper:BandSetting[];lower:BandSetting[];rsi:{enabled:boolean;length:number;upper:number;lower:number}};
export const defaultIndicators=():IndicatorSettings=>({version:1,unit:'bps',average:{kind:'WMA',length:155,visible:true},upper:[40,60,90].map(bps=>({bps,visible:bps===90})),lower:[40,60,90].map(bps=>({bps,visible:bps===90})),rsi:{enabled:true,length:14,upper:70,lower:30}});
export function indicatorSettings(raw:any):IndicatorSettings{
 if(raw?.version!==1||!['bps','percent'].includes(raw.unit)||!['MA','EMA','WMA'].includes(raw.average?.kind)||!Number.isInteger(raw.average.length)||raw.average.length<1||raw.average.length>2000||typeof raw.average.visible!=='boolean')throw new Error('均線長度須為 1–2,000 的整數。');
 const bands=(value:any):BandSetting[]=>{if(!Array.isArray(value)||value.length!==3||value.some(v=>!Number.isFinite(v?.bps)||v.bps<.1||v.bps>9999||typeof v.visible!=='boolean'))throw new Error('每側須有三條乖離線，幅度介於 0.1–9,999 bps。');return value.map(v=>({bps:v.bps,visible:v.visible}));};
 const r=raw.rsi;if(typeof r?.enabled!=='boolean'||!Number.isInteger(r.length)||r.length<2||r.length>1000||!Number.isFinite(r.upper)||!Number.isFinite(r.lower)||!(0<r.lower&&r.lower<r.upper&&r.upper<100))throw new Error('RSI 週期須為 2–1,000，且 0＜超賣＜超買＜100。');
 return {version:1,unit:raw.unit,average:{kind:raw.average.kind,length:raw.average.length,visible:raw.average.visible},upper:bands(raw.upper),lower:bands(raw.lower),rsi:{enabled:r.enabled,length:r.length,upper:r.upper,lower:r.lower}};
}
export const averageEnabled=(s:IndicatorSettings)=>s.average.visible||[...s.upper,...s.lower].some(b=>b.visible);
export function warmupBars(s:IndicatorSettings){return Math.max(averageEnabled(s)?s.average.length*(s.average.kind==='EMA'?10:1):0,s.rsi.enabled?s.rsi.length*20+1:0);}
export type IndicatorBar=Pick<Candle,'t'|'c'|'closed'>&{complete?:boolean};
export type IndicatorPoint={t:number;average:number|null;rsi:number|null};
export type IndicatorHistoryRequest={type:'indicator-history';asset:Asset;interval:Interval;from:number;to:number};
export function validIndicatorHistory(r:any):r is IndicatorHistoryRequest{return r?.type==='indicator-history'&&ASSETS.includes(r.asset)&&INDICATOR_INTERVALS.includes(r.interval)&&Number.isSafeInteger(r.from)&&r.from>=0&&Number.isSafeInteger(r.to)&&r.to>r.from&&r.from%r.interval===0&&r.to%r.interval===0&&(r.to-r.from)/r.interval<=20001;}
export const bandPrice=(average:number,bps:number,upper:boolean)=>average*(1+(upper?1:-1)*bps/10000);

/** Closed state is committed once; live previews never feed back into smoothing. */
class Accumulator{
 private ring:number[]=[];private index=0;private sum=0;private weighted=0;private ema:number|null=null;
 private previous:number|null=null;private changes=0;private gain=0;private loss=0;
 constructor(private settings:IndicatorSettings){}
 preview(price:number){
  const s=this.settings,n=s.average.length,count=this.ring.length;
  const sum=this.sum+price-(count===n?this.ring[this.index]:0),weighted=count===n?this.weighted-this.sum+n*price:this.weighted+(count+1)*price;
  const average=!averageEnabled(s)||count+1<n?null:s.average.kind==='MA'?sum/n:s.average.kind==='WMA'?weighted/(n*(n+1)/2):this.ema===null?sum/n:this.ema+2/(n+1)*(price-this.ema);
  let rsi:number|null=null;const period=s.rsi.length,delta=this.previous===null?null:price-this.previous;
  if(s.rsi.enabled&&delta!==null&&this.changes+1>=period){const up=Math.max(0,delta),down=Math.max(0,-delta),g=this.changes<period?(this.gain+up)/period:(this.gain*(period-1)+up)/period,l=this.changes<period?(this.loss+down)/period:(this.loss*(period-1)+down)/period;rsi=g===0&&l===0?50:l===0?100:g===0?0:100-100/(1+g/l);}
  return {average,rsi};
 }
 commit(price:number){
  const next=this.preview(price),n=this.settings.average.length,count=this.ring.length;
  this.weighted=count===n?this.weighted-this.sum+n*price:this.weighted+(count+1)*price;
  this.sum+=price-(count===n?this.ring[this.index]:0);if(count<n)this.ring.push(price);else{this.ring[this.index]=price;this.index=(this.index+1)%n;}if(this.settings.average.kind==='EMA')this.ema=next.average;
  if(this.previous!==null){const delta=price-this.previous,p=this.settings.rsi.length;this.gain=this.changes<p?this.gain+Math.max(0,delta):(this.gain*(p-1)+Math.max(0,delta))/p;this.loss=this.changes<p?this.loss+Math.max(0,-delta):(this.loss*(p-1)+Math.max(0,-delta))/p;this.changes++;if(this.changes===p){this.gain/=p;this.loss/=p;}}
  this.previous=price;return next;
 }
}
export class IndicatorEngine{
 private state:Accumulator;private committed:number|null=null;
 constructor(readonly settings:IndicatorSettings,readonly interval:number){this.state=new Accumulator(settings);}
 reset(){this.state=new Accumulator(this.settings);this.committed=null;}
 next(bar:IndicatorBar):IndicatorPoint{
  if(!Number.isFinite(bar.c)||bar.c<=0||bar.complete===false&&bar.closed){this.reset();return {t:bar.t,average:null,rsi:null};}
  if(this.committed!==null&&bar.t<=this.committed)return {t:bar.t,average:null,rsi:null};
  if(this.committed!==null&&bar.t!==this.committed+this.interval){if(!bar.closed)return {t:bar.t,average:null,rsi:null};this.reset();}
  const value=bar.closed?this.state.commit(bar.c):this.state.preview(bar.c);if(bar.closed)this.committed=bar.t;
  return {t:bar.t,...value};
 }
 get through(){return this.committed;}
}
