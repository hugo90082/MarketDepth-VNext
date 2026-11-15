/// <reference lib="webworker" />
import {IndicatorEngine,indicatorSettings,averageEnabled,warmupBars,type IndicatorBar,type IndicatorPoint} from '../../shared/technical-indicators';
const scope=self as unknown as DedicatedWorkerGlobalScope;
type Context={key:string;from:number;engine:IndicatorEngine;bars:IndicatorBar[]};
const contexts=new Map<string,Context>();
const status=(c:Context,points:IndicatorPoint[])=>{const last=points.at(-1),s=c.engine.settings;return last&&((averageEnabled(s)&&last.average===null)||(s.rsi.enabled&&last.rsi===null))?'預熱中／資料不足；K 線缺格後須重新累積連續資料。':'';};
const tailIndex=(bars:IndicatorBar[],time:number)=>{for(let i=bars.length-1;i>=Math.max(0,bars.length-4);i--)if(bars[i].t===time)return i;return -1;};
scope.onmessage=e=>{
 const m=e.data;if(m.type==='dispose'){contexts.delete(m.id);return;}
 try{
  if(m.type==='reset'){
   const s=indicatorSettings(m.settings),bars=m.bars as IndicatorBar[],engine=new IndicatorEngine(s,m.interval),points=bars.map(b=>engine.next(b)),c={key:m.key,from:m.from,engine,bars};contexts.set(m.id,c);
   scope.postMessage({id:m.id,key:m.key,reset:true,points:points.filter(p=>p.t>=m.from),status:status(c,points)});
  }else if(m.type==='tail'){
   const c=contexts.get(m.id);if(!c||c.key!==m.key)return;
   if(Number.isSafeInteger(m.from)&&m.from>c.from){c.from=m.from;const cutoff=c.from-warmupBars(c.engine.settings)*c.engine.interval;if(c.bars[0]?.t<cutoff-512*c.engine.interval)c.bars=c.bars.filter(b=>b.t>=cutoff);}
   const patches=m.bars as IndicatorBar[];let rebuild=false;
   for(const b of patches){const old=c.bars[tailIndex(c.bars,b.t)];if(old&&b.t<=(c.engine.through??-1)&&(old.c!==b.c||old.closed!==b.closed||old.complete!==b.complete))rebuild=true;}
   for(const b of patches){const i=tailIndex(c.bars,b.t);if(i>=0)c.bars[i]=b;else c.bars.push(b);}
   let points:IndicatorPoint[];if(rebuild){c.engine.reset();points=c.bars.map(b=>c.engine.next(b)).filter(p=>p.t>=c.from);}
   else points=patches.filter(b=>b.t>(c.engine.through??-1)).map(b=>c.engine.next(b)).filter(p=>p.t>=c.from);
   scope.postMessage({id:m.id,key:m.key,reset:rebuild,points,...(points.length?{status:status(c,points)}:{})});
  }
 }catch(error){scope.postMessage({id:m.id,key:m.key,error:error instanceof Error?error.message:'指標計算失敗。'});}
};
