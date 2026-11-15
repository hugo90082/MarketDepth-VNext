import {test} from 'node:test';
import assert from 'node:assert/strict';
import {profileVisibleRange,profileLabelPositions,PROFILE_AXIS_GAP,PROFILE_CANDLE_GAP} from '../src/profile/layout';
import {ProfilePrimitive} from '../src/profile/ProfilePrimitive';
import type {ProfileFrame} from '../shared/order-book-profile';
import {candleChange} from '../shared/chart-data';

test('switching from a recent single candle to an earlier candle requires replacement',()=>{
 const bar={o:100,h:101,l:99,c:100,v:1,closed:false};
 assert.equal(candleChange([{...bar,t:600000}],[{...bar,t:0}]),'all');
 assert.equal(candleChange([{...bar,t:600000}],[{...bar,t:600000,c:101}]),'last');
});

test('latest candle entire cell stays outside profile at all research periods and pane widths',()=>{
 for(const paneWidth of [210,300,599,600,1200,2100])for(const cells of [2,120,1440,10080,20160]){
  const width=140,range=profileVisibleRange({from:0,to:cells-1},paneWidth,width);
  const spacing=paneWidth/(range.to-range.from+1);
  const lastCentre=paneWidth-(range.to-(cells-1)+.5)*spacing-1;
  const profileLeft=paneWidth-PROFILE_AXIS_GAP-width;
  assert.ok(profileLeft-(lastCentre+spacing/2)>=PROFILE_CANDLE_GAP-1e-7);
  assert.equal(range.from,0);
 }
 assert.deepEqual(profileVisibleRange({from:5,to:50},1200,0),{from:5,to:60});
});

test('six concentrated labels avoid each other and both pane edges',()=>{
 for(const targets of [[-4,-3,-2,0,1,2],[100,101,102,103,104,105],[590,591,592,593,594,595]]){
  const positions=profileLabelPositions(targets,600);
  assert.ok(positions[0]>=14);assert.ok(positions.at(-1)!<=596);
  for(let i=1;i<positions.length;i++)assert.ok(positions[i]-positions[i-1]>=18);
 }
 assert.deepEqual(profileLabelPositions([100,200,300],600),[100,200,300]);
});

test('profile text, backgrounds and displaced leaders remain inside the column',()=>{
 const text:any[]=[],rects:any[]=[],points:any[]=[];
 const ctx:any={save(){},restore(){},beginPath(){},clip(){},stroke(){},rect(...a:any[]){rects.push(a);},fillRect(...a:any[]){rects.push(a);},moveTo(...a:any[]){points.push(a);},lineTo(...a:any[]){points.push(a);},measureText(){return{width:58};},fillText(...a:any[]){text.push(a);}};
 const series:any={priceToCoordinate:(p:number)=>600-p,coordinateToPrice:(y:number)=>600-y};
 const chart:any={paneSize:()=>({width:1000,height:600})};
 const primitive=new ProfilePrimitive(chart,series,()=>{});
 const frame={max:6000000,levels:Array.from({length:3},(_,i)=>({price:490+i,bid:2000000+i*1000000,ask:4000000+i*1000000,bidComplete:true,askComplete:true,parts:{}}))} as ProfileFrame;
 primitive.set(frame,false,140);
 const locationBefore=Object.getOwnPropertyDescriptor(globalThis,'location');
 Object.defineProperty(globalThis,'location',{configurable:true,value:{hostname:'example.com'}});
 try{(primitive.paneViews()[0].renderer() as any).draw({useMediaCoordinateSpace:(draw:any)=>draw({context:ctx,mediaSize:{width:1000,height:600}})});}finally{if(locationBefore)Object.defineProperty(globalThis,'location',locationBefore);else delete (globalThis as any).location;}
 assert.equal(text.length,6);assert.ok(text.every(t=>t[1]===988));
 assert.ok(rects.every(r=>r[0]>=852&&r[0]+r[2]<=992));
 assert.ok(points.every(p=>p[0]>=852&&p[0]<=992));
 assert.equal(ctx.textAlign,'right');assert.equal(ctx.textBaseline,'bottom');
});
