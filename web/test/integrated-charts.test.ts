import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ChartSync} from '../src/profile/chart-sync';
import {commonChartTimeline} from '../shared/chart-data';

test('repeated chart redraw crosshair notifications do not schedule another chart redraw',()=>{
 const sync=new ChartSync(),queued:Function[]=[];
 for(const id of ['BTC','ETH','SOL'])sync.register(id,{chart:{applyOptions:()=>queued.push(()=>sync.crosshair(id,600000,1)),paneSize:()=>({height:150}),setCrosshairPosition:()=>{},clearCrosshairPosition:()=>{}},candle:{coordinateToPrice:()=>1},ratio:{coordinateToPrice:()=>0},value:()=>.2,hover:()=>{},pause:()=>{},fit:()=>{}} as any);
 sync.crosshair('BTC',600000,1);
 for(let n=0;queued.length&&n<20;n++)queued.shift()!();
 assert.equal(queued.length,0,'asynchronous redraw echoes must settle rather than keep scheduling React hover updates');
});

test('integration aligns UTC ranges across different origins, guards echoes and synchronizes latest',()=>{
 const sync=new ChartSync(),log:Record<string,any>={};
 const peer=(id:string)=>({chart:{timeScale:()=>({setVisibleLogicalRange:(r:any)=>{log[id].range=r;sync.viewport(id,r);},getVisibleLogicalRange:()=>log[id].range}),applyOptions:()=>{},paneSize:()=>({height:500}),clearCrosshairPosition:()=>{},setCrosshairPosition:()=>{}},candle:{coordinateToPrice:()=>1},ratio:{coordinateToPrice:()=>0},value:()=>null,hover:()=>{},pause:()=>log[id].paused++,fit:()=>{log[id].fits++;log[id].range={from:0,to:10};}} as any);
 for(const id of ['BTC','ETH','SOL']){log[id]={paused:0,fits:0};sync.register(id,peer(id));}
 sync.grid('BTC',600000,60000,()=>{});sync.grid('ETH',660000,60000,()=>{});sync.grid('SOL',540000,60000,()=>{});
 sync.viewport('BTC',{from:1,to:5});assert.deepEqual(log.ETH.range,{from:0,to:4});assert.deepEqual(log.SOL.range,{from:2,to:6});
 sync.pause();assert.equal(sync.following,false);assert.equal(log.SOL.paused,1);
 sync.grid('ETH',720000,60000,()=>{});assert.deepEqual(log.ETH.range,{from:-1,to:3});
 sync.latest();assert.equal(sync.following,true);assert.equal(log.ETH.fits,1);assert.deepEqual(log.ETH.range,{from:-2,to:8});
 assert.deepEqual(commonChartTimeline(600001,780001,60000),[600,660,720,780]);
});

test('three adjusted integrated charts advance one shared period, not three, even with different grid origins',()=>{
 const sync=new ChartSync(),ranges=new Map<string,any>(),origins=[600000,660000,540000];
 for(const [i,id] of ['BTC','ETH','SOL'].entries()){
  sync.register(id,{chart:{timeScale:()=>({getVisibleLogicalRange:()=>ranges.get(id),setVisibleLogicalRange:(r:any)=>{ranges.set(id,{...r});sync.viewport(id,r);}})},pause:()=>{},fit:()=>{}} as any);
  sync.grid(id,origins[i],60000,()=>{},{at:1200000,enabled:true});
 }
 sync.pause();sync.viewport('BTC',{from:2.25,to:12.75});
 for(const [i,id] of ['BTC','ETH','SOL'].entries())sync.grid(id,origins[i]+60000,60000,()=>{},{at:1260000,enabled:true});
 assert.deepEqual(ranges.get('BTC'),{from:2.25,to:12.75},'rolling origin and one elapsed bar cancel, preserving candle pixel positions');
 assert.deepEqual(ranges.get('ETH'),{from:1.25,to:11.75});assert.deepEqual(ranges.get('SOL'),{from:3.25,to:13.75});
 for(const [i,id] of ['BTC','ETH','SOL'].entries())sync.grid(id,origins[i]+60000,60000,()=>{},{at:1320000,enabled:true});
 assert.deepEqual(ranges.get('BTC'),{from:3.25,to:13.75});assert.deepEqual(ranges.get('ETH'),{from:2.25,to:12.75});assert.deepEqual(ranges.get('SOL'),{from:4.25,to:14.75});
 for(const [i,id] of ['BTC','ETH','SOL'].entries())sync.grid(id,origins[i]+60000,60000,()=>{},{at:1440000,enabled:false});
 assert.deepEqual(ranges.get('BTC'),{from:3.25,to:13.75});
});

test('second indicator crosshair targets the second histogram and leaves missing peer horizontal line hidden',()=>{
 const sync=new ChartSync(),seen:Record<string,any>={};
 for(const id of ['BTC','ETH','SOL']){
  seen[id]={};const primary={coordinateToPrice:()=>.1},secondary={coordinateToPrice:()=>0};
  sync.register(id,{chart:{applyOptions:(o:any)=>seen[id].horizontal=o.crosshair.horzLine.visible,paneSize:()=>({height:150}),setCrosshairPosition:(p:number,t:number,s:any)=>{seen[id].position=[p,t,s];sync.crosshair(id,t*1000,2);},clearCrosshairPosition:()=>seen[id].cleared=true},candle:{},ratio:primary,ratio2:secondary,value:(_t:number,pane:number)=>pane===2?(id==='SOL'?null:.65):.1,hover:(t:number|null)=>seen[id].hover=t,pause:()=>{},fit:()=>{}} as any);
  seen[id].secondary=secondary;
 }
 sync.crosshair('BTC',600000,2);assert.deepEqual(seen.ETH.position,[.65,600,seen.ETH.secondary]);assert.equal(seen.SOL.position[2],seen.SOL.secondary);assert.equal(seen.SOL.horizontal,false);assert.equal(seen.SOL.hover,600000);
 sync.crosshair('BTC',null,2);assert.equal(seen.ETH.cleared,true);assert.equal(seen.SOL.hover,null);
});

test('crosshair uses each own value, preserves missing values and clears all peers without recursion',()=>{
 const sync=new ChartSync(),seen:Record<string,any>={};
 function peer(id:string,value:number|null){seen[id]={};return {chart:{timeScale:()=>({}),paneSize:()=>({height:400}),applyOptions:(o:any)=>seen[id].horizontal=o.crosshair.horzLine.visible,setCrosshairPosition:(p:number,t:number)=>{seen[id].position=[p,t];sync.crosshair(id,t*1000,0);},clearCrosshairPosition:()=>seen[id].cleared=true},candle:{coordinateToPrice:()=>123},ratio:{coordinateToPrice:()=>0},value:()=>value,hover:(t:number|null)=>seen[id].hover=t,pause:()=>{},fit:()=>{}} as any;}
 sync.register('BTC',peer('BTC',80000));sync.register('ETH',peer('ETH',2500));sync.register('SOL',peer('SOL',null));
 sync.crosshair('BTC',600000,0);assert.deepEqual(seen.ETH.position,[2500,600]);assert.equal(seen.SOL.horizontal,false);assert.equal(seen.SOL.hover,600000);
 sync.crosshair('SOL',600000,0);assert.equal(seen.SOL.horizontal,true);
 sync.crosshair('SOL',null,0);assert.equal(seen.BTC.cleared,true);assert.equal(seen.ETH.hover,null);
});

 test('third indicator pane synchronizes each own RSI and preserves its actual line series identity',()=>{
 const sync=new ChartSync(),seen:Record<string,any>={};
 for(const [id,value] of [['BTC',72],['ETH',28],['SOL',50]] as const){const rsi={};seen[id]={series:rsi};sync.register(id,{chart:{applyOptions:()=>{},paneSize:()=>({height:120}),setCrosshairPosition:(p:number,t:number,s:any)=>seen[id].position=[p,t,s],clearCrosshairPosition:()=>seen[id].cleared=true},candle:{},ratio:{},ratio2:{},rsi,value:(_t:number,pane:number)=>pane===3?value:null,hover:(t:number|null)=>seen[id].hover=t,pause:()=>{},fit:()=>{}} as any);}
 sync.crosshair('BTC',600000,3);assert.deepEqual(seen.ETH.position,[28,600,seen.ETH.series]);assert.equal(seen.ETH.position[2],seen.ETH.series);assert.deepEqual(seen.SOL.position,[50,600,seen.SOL.series]);assert.equal(seen.SOL.position[2],seen.SOL.series);sync.crosshair('BTC',null,3);assert.equal(seen.ETH.cleared,true);
 });
