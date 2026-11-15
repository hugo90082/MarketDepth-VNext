import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {runInNewContext} from 'node:vm';
import {randomUUID} from 'node:crypto';
import {emptyRow} from '../shared/contract';
import {defaultIndicators} from '../shared/technical-indicators';
import {ChartSync} from '../src/profile/chart-sync';

// Run the actual TSX effects with deterministic hooks and chart/transport boundaries.
// No exchange traffic, browser timing or source-text assertions are involved.
async function mount(file:string,name:string){
 const slots:any[]=[],jobs:Function[]=[],timeouts=new Map<number,Function>(),intervals=new Map<number,Function>();
 const listeners=new Set<Function>(),demands=new Map<string,any>(),calls:any[]=[],widths:number[]=[],primitives:any[]=[];
 let cursor=0,dirty=false,tree:any,props:any,id=0,component:any;
 const changed=(a:any[],b:any[])=>!a||!b||a.length!==b.length||a.some((v,i)=>!Object.is(v,b[i]));
 const effect=(run:Function,deps:any[])=>{const i=cursor++,old=slots[i];if(!old||changed(old.deps,deps)){slots[i]={deps,cleanup:old?.cleanup};jobs.push(()=>{slots[i].cleanup?.();slots[i].cleanup=run();});}};
 const hooks={memo:(f:Function)=>f,useEffect:effect,useLayoutEffect:effect,
  useRef:(value:any)=>{const i=cursor++;return slots[i]??(slots[i]={current:value});},
  useState:(value:any)=>{const i=cursor++;if(!slots[i])slots[i]={value:typeof value==='function'?value():value};return[slots[i].value,(next:any)=>{const v=typeof next==='function'?next(slots[i].value):next;if(!Object.is(v,slots[i].value)){slots[i].value=v;dirty=true;}}];},
  useMemo:(f:Function,deps:any[])=>{const i=cursor++;if(!slots[i]||changed(slots[i].deps,deps))slots[i]={deps,value:f()};return slots[i].value;}};
 const gestures=new Map<string,Function>();let crosshair:Function=()=>{};
 const element={style:{},children:[],clientHeight:900,clientWidth:700,addEventListener:(name:string,cb:Function)=>gestures.set(name,cb),removeEventListener:(name:string)=>gestures.delete(name)};
 let viewport:any=null;const rangeListeners=new Set<Function>();
 const scale={height:()=>32,timeToIndex:(t:number)=>t/60,getVisibleLogicalRange:()=>viewport,setVisibleLogicalRange:(r:any)=>{viewport={...r};calls.push(['range',r]);for(const cb of rangeListeners)cb(r);},subscribeVisibleLogicalRangeChange:(cb:Function)=>rangeListeners.add(cb)};
 let baseShift=false;
 const candle={setData:(v:any)=>calls.push(['candles',v]),update:(v:any)=>{calls.push(['candle-update',v]);if(baseShift&&viewport)scale.setVisibleLogicalRange({from:viewport.from-1,to:viewport.to-1});},priceScale:()=>({applyOptions(){}}),priceToCoordinate:(p:number)=>p,coordinateToPrice:(y:number)=>y};
 const ratios=[1,2].map(i=>({setData:(v:any)=>calls.push([i===1?'ratio':'ratio2',v]),applyOptions:(o:any)=>calls.push(['ratio-options',i,o]),createPriceLine(){},attachPrimitive(){},priceScale:()=>({applyOptions(){}})}));
 const pane={attachPrimitive:(p:any)=>{calls.push(['attach']);primitives.push(p);},detachPrimitive:()=>calls.push(['detach']),setStretchFactor(){},getStretchFactor:()=>0,getHeight:()=>580};
 const panes=[pane,...[1,2].map(i=>({...pane,setStretchFactor:(n:number)=>calls.push(['pane-weight',i,n]),getHeight:()=>150}))];
 const chart={priceScale:()=>({width:()=>80}),timeScale:()=>scale,paneSize:()=>({width:700,height:580}),panes:()=>panes,chartElement:()=>element,subscribeCrosshairMove:(f:Function)=>{crosshair=f;},unsubscribeCrosshairMove(){},remove:()=>calls.push(['remove-chart']),removeSeries:()=>{calls.push(['remove-series']);panes.splice(3);},addSeries:(type:string,_options:any,index:number)=>{calls.push(['add-series',type,_options,index]);const lineId=calls.length;if(index===3&&!panes[3])panes.push({...pane,getHeight:()=>150});return type==='candle'?candle:type==='ratio'?ratios[index-1]:{setData(){},update(){},applyOptions:(o:any)=>calls.push(['line-options',lineId,o]),createPriceLine:(o:any)=>{calls.push(['price-guide',index,o]);return{};},removePriceLine(){},attachPrimitive(){},priceToCoordinate:(p:number)=>p,priceScale:()=>({applyOptions(){}})};}};
 class Primitive{frame:any=null;view:Function;constructor(_c:any,_s:any,view:Function){this.view=view;}set(frame:any){this.frame=frame;}priceAt(p:number){return p;}updateAllViews(){this.view(80,120,650);}}
 const runtime={profileCapability:()=>true,events:(cb:Function)=>{listeners.add(cb);return()=>listeners.delete(cb);},profileDemand:(key:string,d:any)=>{calls.push(['demand',key,d]);if(d)demands.set(key,{...d,id:key});else demands.delete(key);return key;}};
 const mocks:Record<string,string>={react:'export const {memo,useEffect,useLayoutEffect,useRef,useState,useMemo}=H.hooks;',
  'react/jsx-runtime':'export const Fragment="fragment";export const jsx=(type,props)=>({type,props});export const jsxs=jsx;',
  'lucide-react':'export const LocateFixed="icon",MoveHorizontal="icon";',
  'lightweight-charts':'export const createChart=()=>{H.calls.push(["create-chart"]);return H.chart;};export const CandlestickSeries="candle",HistogramSeries="ratio",LineSeries="grid",ColorType={Solid:1},CrosshairMode={Normal:1},LineStyle={Dashed:1,Dotted:2},TickMarkType={DayOfMonth:1};',
  './ProfilePrimitive':'export const ProfilePrimitive=H.Primitive;',
  '../runtime/client':'export const marketRuntime=H.runtime;',
  './profile/OrderBookProfile':'export const OrderBookProfile="profile";',
  './indicators/client':'export const indicatorClient={connect:()=>()=>{},update:()=>{H.calls.push(["indicator-update"]);}};',
};
 const output=await build({entryPoints:[file],bundle:true,write:false,format:'cjs',platform:'node',jsx:'automatic',plugins:[{name:'boundaries',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
 const module={exports:{} as any};const document={hidden:false,addEventListener(){},removeEventListener(){}};
 runInNewContext(output.outputFiles[0].text,{exports:module.exports,module,H:{hooks,chart,calls,Primitive,runtime},crypto:{randomUUID},document,Date,Intl,
  ResizeObserver:class{cb:Function;constructor(cb:Function){this.cb=cb;}observe(){timeouts.set(++id,this.cb);}disconnect(){}},
  setTimeout:(f:Function)=>{timeouts.set(++id,f);return id;},clearTimeout:(i:number)=>timeouts.delete(i),setInterval:(f:Function)=>{intervals.set(++id,f);return id;},clearInterval:(i:number)=>intervals.delete(i),requestAnimationFrame:(f:Function)=>{timeouts.set(++id,f);return id;},cancelAnimationFrame:(i:number)=>timeouts.delete(i)});
 component=module.exports[name];
 function refs(node:any){if(!node||typeof node!=='object')return;if(node.props?.ref)node.props.ref.current=element;const children=node.props?.children;for(const child of Array.isArray(children)?children:[children])refs(child);}
 function render(next=props){props=next;for(let n=0;n<20;n++){dirty=false;cursor=0;tree=component(props);refs(tree);while(jobs.length)jobs.shift()!();if(!dirty)return tree;}throw Error('render did not settle');}
 const flush=()=>{for(let n=0;timeouts.size&&n<20;n++){const q=[...timeouts.values()];timeouts.clear();for(const f of q)f();render();}};
 return{render,flush,calls,widths,demands,primitives,chart,candle,simulateBaseShift:()=>{baseShift=true;},viewport:()=>({...viewport}),setViewport:(r:any)=>scale.setVisibleLogicalRange(r),crosshair:(event:any)=>crosshair(event),gesture:(name:string)=>gestures.get(name)?.(),emit:(m:any)=>{for(const f of listeners)f(m);render();},tree:()=>tree,clock:()=>{for(const f of intervals.values())f();render();},unmount:()=>{for(const s of slots)s?.cleanup?.();}};
}

test('manually zoomed viewport advances exactly one cell per selected candle period without refitting',async()=>{
 const h=await mount('src/Charts.tsx','Charts'),p={rows:[],candles:[{t:600000,o:100,h:101,l:99,c:100,v:1}],asset:'BTC',venue:'binance',zones:[0],from:600000,to:660000,hours:1,interval:60000,profileMarket:'usdm',profileEnabled:true,autoAdvance:true};
 h.render(p);h.flush();h.gesture('pointerdown');h.setViewport({from:8.25,to:16.75});const start=h.calls.length;
 h.render({...p,to:719999});h.flush();assert.deepEqual(h.viewport(),{from:8.25,to:16.75},'same K-line period must not move');
 h.render({...p,to:720000});h.flush();assert.deepEqual(h.viewport(),{from:9.25,to:17.75},'new period must move the adjusted view by one cell');
 h.render({...p,to:720001,venue:'coinbase',zones:[0,1]});h.flush();assert.deepEqual(h.viewport(),{from:9.25,to:17.75});
 assert.equal(h.calls.slice(start).some(c=>['create-chart','remove-chart'].includes(c[0])),false);h.unmount();
});

test('viewport progression uses every supported period, preserves zoom after a timer gap and can be paused',async()=>{
 for(const interval of [60000,300000,900000,3600000,14400000,43200000]){
  const h=await mount('src/Charts.tsx','Charts'),t=interval*100,p={rows:[],candles:[{t,o:100,h:101,l:99,c:100,v:1}],asset:'BTC',venue:'binance',zones:[0],from:t-interval*10,to:t,hours:24,interval,profileMarket:'usdm',profileEnabled:true,autoAdvance:true};
  h.render(p);h.flush();h.gesture('wheel');h.setViewport({from:3.5,to:12.5});
  h.render({...p,to:t+interval-1});h.flush();assert.deepEqual(h.viewport(),{from:3.5,to:12.5});
  h.render({...p,to:t+interval*3});h.flush();assert.deepEqual(h.viewport(),{from:6.5,to:15.5});
  h.render({...p,to:t+interval*4,autoAdvance:false});h.flush();assert.deepEqual(h.viewport(),{from:6.5,to:15.5});
  h.render({...p,to:t+interval*8,autoAdvance:true});h.flush();assert.deepEqual(h.viewport(),{from:6.5,to:15.5},'reenabling resumes here without replaying the paused periods');
  h.render({...p,to:t+interval*9,autoAdvance:true});h.flush();assert.deepEqual(h.viewport(),{from:7.5,to:16.5});h.unmount();
 }
});

test('a candle insertion base-index callback cannot cancel the clock advance in single or integrated charts',async()=>{
 for(const integrated of [false,true]){
  const h=await mount('src/Charts.tsx','Charts'),first={t:600000,o:100,h:101,l:99,c:100,v:1},p={rows:[],candles:[first],asset:'BTC',venue:'binance',zones:[0],from:540000,to:600000,hours:1,interval:60000,profileMarket:'usdm',profileEnabled:true,autoAdvance:true,sync:integrated?new ChartSync():undefined};
  h.render(p);h.flush();h.gesture('pointerdown');h.setViewport({from:8.25,to:16.75});h.simulateBaseShift();
  h.render({...p,to:660000,candles:[first,{...first,t:660000}]});h.flush();assert.deepEqual(h.viewport(),{from:9.25,to:17.75},'restore after all candle, grid and ratio writes, never during them');h.unmount();
 }
});

test('actual chart callback synchronizes pointer movement but rejects synthetic redraw echoes and clears on leave',async()=>{
 const h=await mount('src/Charts.tsx','Charts'),events:any[]=[];
 h.render({rows:[],candles:[],asset:'BTC',venue:'binance',zones:[0],from:600000,to:660000,hours:1,interval:60000,profileMarket:'usdm',profileEnabled:true,sync:{register:()=>()=>{},grid:(_id:string,_origin:number,_interval:number,apply:Function)=>apply(),viewport:()=>{},crosshair:(...args:any[])=>events.push(args)}});h.flush();
 h.crosshair({time:600,paneIndex:2});assert.equal(events.length,0);
 h.crosshair({time:600,paneIndex:2,sourceEvent:{type:'mousemove'}});assert.deepEqual(events,[['BTC',600000,2]]);
 h.gesture('pointerleave');assert.deepEqual(events.at(-1),['BTC',null,0]);h.unmount();
});

test('indicator edits and RSI toggle keep the candle chart and viewport alive',async()=>{
 const h=await mount('src/Charts.tsx','Charts'),settings=defaultIndicators();
 const p={rows:[],candles:[{t:600000,o:100,h:101,l:99,c:100,v:1,closed:true}],asset:'BTC',venue:'binance',zones:[0],from:600000,to:660000,hours:1,interval:60000,profileMarket:'usdm',profileEnabled:true,indicators:settings};
 h.render(p);h.flush();const start=h.calls.length;
 const overlays=h.calls.filter(c=>c[0]==='add-series'&&c[2].lineWidth===2&&c[3]===undefined);assert.equal(overlays.length,7);assert.equal(overlays[0][2].color,'#ffff00');assert.deepEqual(overlays.slice(1).map(c=>c[2].color),['#3bf7c8','#f7903b','#3b82f6','#3bf7c8','#f7903b','#3b82f6']);
 const yellow=h.calls.filter(c=>c[0]==='price-guide'&&c[1]===3&&c[2].color==='#ffff00');assert.deepEqual(yellow.map(c=>c[2].price),[85,15]);assert.ok(yellow.every(c=>c[2].lineStyle===1&&!c[2].axisLabelVisible));
 const nodes=(node:any):any[]=>Array.isArray(node)?node.flatMap(nodes):node&&typeof node==='object'?[node,...nodes(node.props?.children)]:[];assert.deepEqual(nodes(h.tree()).filter(n=>n.props?.['data-pane']===3).map(n=>n.props['data-value']),[30,50,70]);
 h.render({...p,indicators:{...settings,average:{...settings.average,length:99},rsi:{...settings.rsi,enabled:false}}});h.flush();h.render(p);h.flush();
 assert.equal(h.calls.filter(c=>c[0]==='create-chart').length,1);assert.equal(h.calls.slice(start).some(c=>['range','candles','remove-chart'].includes(c[0])),false);assert.equal(h.calls.filter(c=>c[0]==='remove-series').length,1);h.unmount();
});

test('each deviation color updates its positive and negative pair without changing data, viewport or chart instances',async()=>{
 const h=await mount('src/Charts.tsx','Charts'),p={rows:[],candles:[{t:600000,o:100,h:101,l:99,c:100,v:1,closed:true}],asset:'BTC',venue:'binance',zones:[0],from:600000,to:660000,hours:1,interval:60000,profileMarket:'usdm',profileEnabled:true,indicators:defaultIndicators()};
 h.render(p);h.flush();const start=h.calls.length;h.render({...p,bandColors:['#ff00ff','#00ff00','#ffffff']});h.flush();const calls=h.calls.slice(start);
 assert.deepEqual(calls.filter(c=>c[0]==='line-options').map(c=>c[2].color),['#ff00ff','#00ff00','#ffffff','#ff00ff','#00ff00','#ffffff']);assert.equal(calls.some(c=>['create-chart','remove-chart','candles','range','indicator-update'].includes(c[0])),false);h.unmount();
});

function frame(d:any,mode=d.mode){return{type:'profile-frame',...d,mode,sampleAt:Date.now(),max:2e6,levels:[],sources:[{source:'binance',available:true,phase:'正常',mid:100,updateAt:Date.now()}],totals:[{percent:1,bid:2e6,ask:1e6,bidCount:2,askCount:1,bidShare:2/3,bidComplete:true,askComplete:true}]};}
function props(h:any,venue='binance',market='usdm'){return{api:{chart:h.chart,series:h.candle},asset:'BTC',venue,market,enabled:true,compact:true,onWidth:(w:number)=>h.widths.push(w)};}

test('exchange switching retains the actual futures primitive, frame and subscription without width reset',async()=>{
 const h=await mount('src/profile/OrderBookProfile.tsx','OrderBookProfile'),p=props(h);h.render(p);h.flush();
 const demand=[...h.demands.values()].find(d=>d.market==='usdm');h.emit(frame(demand));
 const primitive=h.primitives.at(-1),current=primitive.frame,start=h.calls.length,w=h.widths.length;
 h.render({...p,venue:'coinbase'});h.flush();
 assert.equal(h.primitives.length,1,'source switch must not attach another primitive');assert.equal(primitive.frame,current,'futures frame must stay visible');
 assert.equal(h.calls.slice(start).some(c=>c[0]==='demand'&&c[1].endsWith(':usdm')),false,'futures demand must not change');assert.deepEqual(h.widths.slice(w),[]);
 h.unmount();
});

test('spot switches only its own demand and rejects late frames; cached compatible source returns immediately',async()=>{
 const h=await mount('src/profile/OrderBookProfile.tsx','OrderBookProfile'),p=props(h,'binance','spot');h.render(p);h.flush();
 const original=[...h.demands.values()].find(d=>d.market==='spot');h.emit(frame(original));const primitive=h.primitives.at(-1),cached=primitive.frame;
 const usdm=[...h.demands.values()].find(d=>d.market==='usdm');h.emit(frame(usdm));
 h.render({...p,venue:'coinbase'});h.flush();const next=[...h.demands.values()].find(d=>d.market==='spot');assert.equal(next.mode,'coinbase');assert.notEqual(next.revision,original.revision);
 h.emit(frame(original));assert.equal(primitive.frame,null,'late Binance frame must not masquerade as Coinbase');h.emit(frame(next));assert.equal(primitive.frame.mode,'coinbase');
 h.render(p);h.flush();assert.equal(primitive.frame,cached,'compatible cached Binance source should return without a blank');assert.equal(h.primitives.length,1);
 h.render({...p,venue:'coinbase'});h.emit({type:'book-status',state:{symbol:'BTC',exchange:'Binance',phase:'reconnecting'}});h.render(p);assert.equal(primitive.frame,null,'inactive source must not revive a cached frame after a real disconnect');
 h.emit({type:'profile-capability',capable:true,owner:'new',epoch:2});h.render({...p,market:'usdm'});assert.equal(primitive.frame,null,'a new collector term clears both market caches');h.unmount();
});

test('source and depth changes update ratios without resetting latest or manually controlled chart viewport',async()=>{
 const h=await mount('src/Charts.tsx','Charts'),row=emptyRow(600000);row.d[0][0][0]=[20,10];row.d[1][0][0]=[10,20];
 const p={rows:[row],candles:[{t:600000,o:100,h:101,l:99,c:100,v:1}],asset:'BTC',venue:'binance',zones:[0],from:600000,to:660000,hours:1,interval:60000,profileMarket:'usdm',profileEnabled:true};
 h.render(p);h.flush();const start=h.calls.length;h.render({...p,venue:'coinbase'});h.flush();h.render({...p,venue:'coinbase',zones:[0,1]});h.flush();
 const calls=h.calls.slice(start);assert.equal(calls.filter(c=>c[0]==='ratio').length,2);assert.equal(calls.some(c=>['range','create-chart','candles','remove-chart'].includes(c[0])),false,'source-only update must not reset viewport or candles');
 h.gesture('pointerdown');const manual=h.calls.length;h.render({...p,venue:'coinbase',to:690000});h.flush();assert.equal(h.calls.slice(manual).some(c=>c[0]==='range'),false,'manual viewport must survive a source switch and later live target');
 h.unmount();
});

test('removing below-chart totals preserves the live profile primitive',async()=>{
 const h=await mount('src/profile/OrderBookProfile.tsx','OrderBookProfile');h.render(props(h));h.flush();
 const nodes=(node:any):any[]=>Array.isArray(node)?node.flatMap(nodes):node&&typeof node==='object'?[node,...nodes(node.props?.children)]:[];
 assert.equal(nodes(h.tree()).some(n=>n.props?.className==='large-order-totals'),false);
 const demand=[...h.demands.values()].find(d=>d.market==='usdm');h.emit(frame(demand));assert.equal(h.primitives.at(-1).frame.totals[0].bid,2000000);assert.equal(h.primitives.length,1);h.unmount();
});

test('two depth panes use independent cumulative amounts, retain gaps and update without moving candles',async()=>{
 const h=await mount('src/Charts.tsx','Charts'),a=emptyRow(600000),b=emptyRow(630000);
 for(const row of [a,b])for(let z=0;z<5;z++)row.d[0][0][z]=z<3?[20,10]:[5,20];
 const p={rows:[a,b],candles:[{t:600000,o:100,h:101,l:99,c:100,v:1}],asset:'BTC',venue:'binance',zones:[0,1,2],secondaryZones:[0,1,2,3,4],from:600000,to:660000,hours:1,interval:60000,profileMarket:'usdm',profileEnabled:true};
 h.render(p);h.flush();
 const points=(name:string)=>h.calls.filter(c=>c[0]===name).at(-1)[1];
 assert.equal(points('ratio')[0].value,1/3);assert.equal(points('ratio2')[0].value,0);
 assert.deepEqual(h.calls.filter(c=>c[0]==='pane-weight').slice(0,2).map(c=>c.slice(1)),[[1,120],[2,120]]);
 const start=h.calls.length;h.render({...p,secondaryZones:[3,4]});h.flush();
 assert.equal(points('ratio2')[0].value,-.6);assert.equal(h.calls.slice(start).some(c=>['ratio','range','create-chart','candles'].includes(c[0])),false);
 const missing=emptyRow(630000);for(let z=0;z<3;z++)missing.d[0][0][z]=[20,10];
 h.render({...p,rows:[a,missing]});h.flush();assert.equal(points('ratio')[0].value,1/3);assert.equal('value' in points('ratio2')[0],false);
 const nodes=(node:any):any[]=>Array.isArray(node)?node.flatMap(nodes):node&&typeof node==='object'?[node,...nodes(node.props?.children)]:[];
 const full=nodes(h.tree()).find(n=>n.type==='button'&&n.props.children==='查看完整 ±1.000');full.props.onClick();h.render();
 for(const i of [1,2])assert.deepEqual({...h.calls.filter(c=>c[0]==='ratio-options'&&c[1]===i).at(-1)[2].autoscaleInfoProvider().priceRange},{minValue:-1,maxValue:1});h.unmount();
});

