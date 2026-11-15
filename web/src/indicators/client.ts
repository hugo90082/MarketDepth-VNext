import {marketRuntime,requestMarket} from '../runtime/client';
import {averageEnabled,warmupBars,type IndicatorSettings,type IndicatorBar,type IndicatorPoint} from '../../shared/technical-indicators';
import type {Asset,Candle} from '../../shared/model';
import type {Interval} from '../../shared/contract';
export type IndicatorResult={key:string;reset?:boolean;points?:IndicatorPoint[];status?:string;error?:string};
type Input={asset:Asset;interval:Interval;settings:IndicatorSettings;candles:Candle[]};
type Entry={callback:(r:IndicatorResult)=>void;input?:Input;context?:string;key:string;workKey?:string;owner?:{id:string;epoch:number};request?:string;ready:boolean;generation:number;retry:number;timer?:ReturnType<typeof setTimeout>};
const entries=new Map<string,Entry>();let worker:Worker|null=null,watching=false;
function calculator(){if(!worker){worker=new Worker(new URL('./calculate.worker.ts',import.meta.url),{type:'module'});worker.onmessage=e=>{const m=e.data,entry=entries.get(m.id),owner=marketRuntime.collectorStamp();if(entry&&entry.workKey===m.key&&owner?.id===entry.owner?.id&&owner?.epoch===entry.owner?.epoch&&!document.hidden)entry.callback({...m,key:entry.key});};worker.onerror=()=>{for(const entry of entries.values())entry.callback({key:entry.key,error:'指標計算中斷，請重新整理。'});};}return worker;}
const bar=(c:Candle):IndicatorBar=>({t:c.t,c:c.c,closed:c.closed,complete:(c as Candle&{complete?:boolean}).complete});
// A moving observation window may discard old bars without changing retained history.
// Preserve smoothing state in that case; historical corrections still rebuild.
function rolling(before:Candle[],after:Candle[],interval:number){
 if(!before.length||!after.length||after[0].t<=before[0].t||after.at(-1)!.t<before.at(-1)!.t||after.at(-1)!.t>before.at(-1)!.t+interval)return false;
 const offset=before.findIndex(c=>c.t===after[0].t);if(offset<0)return false;
 for(let i=0;i<Math.min(before.length-offset,after.length)-1;i++){const a=before[i+offset],b=after[i];if(a.t!==b.t||a.c!==b.c||(a as any).complete!==(b as any).complete)return false;}return true;
}
function cancel(e:Entry){clearTimeout(e.timer);if(e.request){void requestMarket({type:'indicator-history-cancel',key:e.request}).catch(()=>{});e.request=undefined;}e.generation++;e.ready=false;e.workKey=undefined;}
function reset(id:string,e:Entry){
 if(!e.input||document.hidden)return;cancel(e);const input=e.input,generation=e.generation,stamp=marketRuntime.collectorStamp();
 if(marketRuntime.indicatorCapability()!==true||!stamp){e.callback({key:e.key,status:marketRuntime.indicatorCapability()===false?'請重新整理所有研究與監控分頁，以啟用新指標。':'等待行情主控'});return;}
 const key=e.key,workKey=key+'#'+generation;e.owner=stamp;
 const valid=()=>entries.get(id)===e&&e.generation===generation&&e.key===key&&!document.hidden&&marketRuntime.collectorStamp()?.epoch===stamp.epoch&&marketRuntime.collectorStamp()?.id===stamp.id;
 const first=input.candles[0]?.t;if(first===undefined)return;
 const count=warmupBars(input.settings),from=Math.max(0,first-count*input.interval),request=e.request=id+':'+generation;
 e.callback({key,status:count?'預熱中':'',error:''});
 const task=count?requestMarket({type:'indicator-history',key:request,asset:input.asset,interval:input.interval,from,to:first},300000):Promise.resolve({ok:true,bars:[]});
 void task.then(result=>{
  if(!valid())return;if(!result.ok||!Array.isArray(result.bars))throw new Error(result.error||'指標前置資料暫時無法讀取。');
  const latest=e.input!,known=new Map<number,IndicatorBar>((result.bars as IndicatorBar[]).map(b=>[b.t,b]));for(const c of latest.candles)known.set(c.t,bar(c));
  e.ready=true;e.retry=0;e.request=undefined;e.workKey=workKey;calculator().postMessage({type:'reset',id,key:workKey,from:first,interval:latest.interval,settings:latest.settings,bars:[...known.values()].sort((a,b)=>a.t-b.t)});
  e.callback({key,status:result.bars.length<count?'前置資料不足；可用連續資料仍參與計算。':'',error:''});
 }).catch(error=>{if(!valid())return;e.request=undefined;e.callback({key,status:'資料不足',error:error instanceof Error?error.message:'指標預熱失敗。'});if(e.retry++<2)e.timer=setTimeout(()=>reset(id,e),Math.min(60000,5000*2**e.retry));});
}
function watch(){if(watching)return;watching=true;document.addEventListener('visibilitychange',()=>{for(const [id,e]of entries){if(document.hidden)cancel(e);else reset(id,e);}});let owner='';marketRuntime.subscribe(()=>{const s=marketRuntime.collectorStamp(),next=s?s.id+':'+s.epoch+':'+marketRuntime.indicatorCapability():'';if(next===owner)return;owner=next;for(const [id,e]of entries)reset(id,e);});}
export const indicatorClient={
 connect(id:string,callback:Entry['callback']){watch();entries.set(id,{callback,key:'',ready:false,generation:0,retry:0});return()=>{const e=entries.get(id);if(e)cancel(e);entries.delete(id);worker?.postMessage({type:'dispose',id});if(!entries.size){worker?.terminate();worker=null;}};},
 update(id:string,input:Input,change:'all'|'last'|'none'){
  const e=entries.get(id);if(!e)return;const owner=marketRuntime.collectorStamp(),context=[input.asset,input.interval,JSON.stringify(input.settings),owner?.id,owner?.epoch].join('|'),roll=e.context===context&&e.ready&&change==='all'&&rolling(e.input?.candles??[],input.candles,input.interval),sameStart=e.input?.candles[0]?.t===input.candles[0]?.t,key=e.context===context&&(sameStart||roll)?e.key:[context,input.candles[0]?.t].join('|');
  const previous=e.input?.candles.slice(-2)??[],closingChanged=input.candles.slice(-2).some(c=>{const old=previous.find(b=>b.t===c.t);return old&&(old.closed!==c.closed||(old as Candle&{complete?:boolean}).complete!==(c as Candle&{complete?:boolean}).complete);});
  e.input=input;e.context=context;if(document.hidden)return;
  if(!averageEnabled(input.settings)&&!input.settings.rsi.enabled){cancel(e);e.key=key;e.callback({key,reset:true,points:[],status:'',error:''});return;}
  if(e.key!==key||change==='all'&&e.ready&&!roll){e.key=key;reset(id,e);return;}
  if(e.ready&&(change!=='none'||closingChanged))calculator().postMessage({type:'tail',id,key:e.workKey,from:input.candles[0]?.t,bars:input.candles.slice(-2).map(bar)});
 }
};
