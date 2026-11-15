import {test} from 'node:test';import assert from 'node:assert/strict';
import {IndicatorEngine,defaultIndicators,indicatorSettings,warmupBars,bandPrice} from '../shared/technical-indicators';
const points=(prices:number[],kind:'MA'|'EMA'|'WMA'='WMA',n=3)=>{const s=defaultIndicators();s.average.kind=kind;s.average.length=n;s.rsi.length=2;const e=new IndicatorEngine(s,60000);return prices.map((c,i)=>e.next({t:i*60000,c,closed:true,complete:true}));};
test('MA, WMA and EMA use arithmetic, oldest-to-newest weights and SMA initialization',()=>{
 assert.deepEqual(points([1,2,3,4],'MA').map(p=>p.average),[null,null,2,3]);assert.equal(points([1,2,3,4],'WMA')[3].average,20/6);assert.deepEqual(points([1,2,3,4,5],'EMA').map(p=>p.average),[null,null,2,3,4]);
});
test('Wilder RSI is seeded by changes and handles flat, up and down data',()=>{
 assert.deepEqual(points([10,10,10,10]).map(p=>p.rsi),[null,null,50,50]);assert.equal(points([1,2,3])[2].rsi,100);assert.equal(points([3,2,1])[2].rsi,0);assert.equal(points([10,12,11,13])[3].rsi,85.71428571428571);
});
test('live previews overwrite rather than feed themselves back into smoothing',()=>{
 const s=defaultIndicators();s.average.kind='EMA';s.average.length=3;s.rsi.length=2;const e=new IndicatorEngine(s,60000);[1,2,3].forEach((c,i)=>e.next({t:i*60000,c,closed:true}));const once=e.next({t:180000,c:5,closed:false});for(let i=0;i<100;i++)assert.deepEqual(e.next({t:180000,c:5,closed:false}),once);assert.deepEqual(e.next({t:180000,c:5,closed:true}),once);assert.equal(e.next({t:240000,c:6,closed:true}).average,4.75);
});
test('missing or incomplete historical candles reset warmup instead of bridging gaps',()=>{
 const s=defaultIndicators();s.average.length=2;s.rsi.length=2;const e=new IndicatorEngine(s,60000);e.next({t:0,c:1,closed:true});assert.equal(e.next({t:60000,c:2,closed:true}).average,5/3);assert.equal(e.next({t:180000,c:3,closed:true}).average,null);assert.equal(e.next({t:240000,c:4,closed:true,complete:false}).average,null);assert.equal(e.next({t:300000,c:5,closed:true}).rsi,null);
});
test('independent band settings, percent conversion and warmup are validated',()=>{
 const s=defaultIndicators();assert.equal(warmupBars(s),281);assert.equal(bandPrice(100,90,true),100.89999999999999);assert.equal(bandPrice(100,90,false),99.1);s.lower[2].bps=60;assert.equal(indicatorSettings(s).lower[2].bps,60);s.average.kind='EMA';assert.equal(warmupBars(s),1550);assert.throws(()=>indicatorSettings({...s,rsi:{...s.rsi,lower:80}}));assert.throws(()=>indicatorSettings({...s,upper:[{bps:0,visible:true},...s.upper.slice(1)]}));
});
