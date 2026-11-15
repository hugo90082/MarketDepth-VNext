import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LargeOrderIndex} from '../src/runtime/large-order-index';
import {largeOrderThreshold,formatLargeAmount,largeOrderTop,type ProfileLevel} from '../shared/order-book-profile';
import type {ProfileBookView} from '../shared/profile-books';
import {registerProfileBook,emitProfileBook} from '../shared/profile-books';
import {ProfileManager} from '../src/runtime/profiles';
import type {ProfileFrame} from '../shared/order-book-profile';
import {profilePixelLevels} from '../src/profile/layout';
const book=(amount=1e6):ProfileBookView=>({bids:new Map([[99,amount/99],[98,1]]),asks:new Map([[101,1]]),ready:true,activityAt:100,updateAt:100,snapshotAt:100,tick:.01,complete:true});
async function install(index:LargeOrderIndex,b:ProfileBookView,continuous=false,at=100){await index.rebuild(b,{bids:[...b.bids],asks:[...b.asks]},continuous,at);}
test('all asset thresholds use raw amounts, hidden episodes survive at exact half, and each applied transition matters',async()=>{
 for(const asset of ['BTC','ETH','SOL'] as const){const t=largeOrderThreshold(asset),index=new LargeOrderIndex(asset);await install(index,book(t));assert.equal(index.levels('bid',90,110)[0].observedAt,100);
  index.patch([{side:'bid',price:99,old:t/99,qty:t/2/99}],200);assert.equal(index.levels('bid',90,110).length,0);
  index.patch([{side:'bid',price:99,old:t/2/99,qty:t/99}],300);assert.equal(index.levels('bid',90,110)[0].observedAt,100);
  index.patch([{side:'bid',price:99,old:t/99,qty:(t/2-.01)/99},{side:'bid',price:99,old:(t/2-.01)/99,qty:t/99}],400);assert.equal(index.levels('bid',90,110)[0].observedAt,400);
  index.patch([{side:'bid',price:99,old:t/99,qty:0}],500);assert.equal(index.levels('bid',90,110).length,0);index.patch([{side:'bid',price:99,old:0,qty:(t-.01)/99}],600);assert.equal(index.levels('bid',90,110).length,0);
 }
});
test('healthy refresh and ordered staging updates preserve or end episodes; a gap resets observation',async()=>{
 const index=new LargeOrderIndex('BTC'),b=book();await install(index,b);await install(index,b,true,200);assert.equal(index.levels('bid',90,110)[0].observedAt,100);
 const many=book();(many.bids as Map<number,number>).set(99,1e6/99);for(let i=0;i<10000;i++)(many.bids as Map<number,number>).set(1+i*.001,1);
 const rebuild=install(index,many,true,300);index.patch([{side:'bid',price:99,old:1e6/99,qty:0},{side:'bid',price:99,old:0,qty:1e6/99}],350);await rebuild;assert.equal(index.levels('bid',90,110)[0].observedAt,350);
 index.invalidate();await install(index,b,false,400);assert.equal(index.levels('bid',90,110)[0].observedAt,400);
});
test('midpoint movement ends an untouched out-of-range episode, reentry restarts, and display queries do not alter it',async()=>{
 const b=book();(b.bids as Map<number,number>).set(90,1e6/90);const index=new LargeOrderIndex('BTC');await install(index,b);assert.equal(index.levels('bid',90,90)[0].observedAt,100);
 index.patch([{side:'bid',price:100,old:0,qty:1}],200);assert.equal(index.levels('bid',90,90).length,0);
 index.patch([{side:'bid',price:100,old:1,qty:0}],300);assert.equal(index.levels('bid',90,90)[0].observedAt,300);
 for(let i=0;i<20;i++)index.levels('bid',95,110);assert.equal(index.levels('bid',90,90)[0].observedAt,300);
});
test('steady patches and queries never iterate live maps; fallback timestamps remain unknown',async()=>{
 const b=book(),index=new LargeOrderIndex('BTC');b.fallback=true;await install(index,b);assert.equal(index.levels('bid',90,110)[0].observedAt,null);
 const forbid=()=>{throw new Error('full-book scan');};(b.bids as Map<number,number>)[Symbol.iterator]=forbid;(b.asks as Map<number,number>)[Symbol.iterator]=forbid;
 for(let i=0;i<100;i++){index.patch([{side:'bid',price:99,old:1e6/99,qty:(1e6+i)/99}],200+i);assert.equal(index.levels('bid',90,110)[0].observedAt,null);}
});
test('K/M formatting and top-three rank use actual amounts and side-specific price ties',()=>{
 assert.equal(formatLargeAmount(50000),'50K');assert.equal(formatLargeAmount(500000),'500K');assert.equal(formatLargeAmount(1200000),'1.2M');assert.equal(formatLargeAmount(1000000),'1M');
 const levels=[90,91,92,93].map(price=>({price,bid:1e6,ask:1e6,bidComplete:true,askComplete:true,parts:{}})) as ProfileLevel[];assert.deepEqual(largeOrderTop(levels,'bid').map(v=>v.price),[93,92,91]);assert.deepEqual(largeOrderTop(levels,'ask').map(v=>v.price),[90,91,92]);
});
test('ALL4 thresholds are per-source before equal-price merging, totals are viewport-independent and unknown is not zero',async()=>{
 let now=1000;const a=book(600000),b=book(600000);a.activityAt=b.activityAt=1000;a.complete=b.complete=false;a.bounds=b.bounds={bid:98,ask:101};registerProfileBook('binance:BTC',()=>a);registerProfileBook('coinbase:BTC',()=>b);
 const frames:ProfileFrame[]=[],manager=new ProfileManager(f=>frames.push(f),()=>now),d={id:'all',revision:1,asset:'BTC' as const,mode:'all4' as const,low:95,high:105,height:900};
 try{manager.setDemands([d]);for(let i=0;i<100&&!manager.diagnostics().indexes.filter(x=>x.key==='binance:BTC'||x.key==='coinbase:BTC').every(x=>x.ready);i++)await new Promise(r=>setTimeout(r,10));manager.pulse();assert.equal(frames.at(-1)!.levels.length,0);assert.equal(frames.at(-1)!.totals[0].bid,0);assert.equal(frames.at(-1)!.totals[3].bid,null);assert.equal(frames.at(-1)!.totals[3].bidShare,null);
  for(const [key,v]of [['binance:BTC',a],['coinbase:BTC',b]] as const){(v.bids as Map<number,number>).set(99,1100000/99);emitProfileBook({key,type:'patch',patches:[{side:'bid',price:99,old:600000/99,qty:1100000/99}]});}manager.pulse();const first=frames.at(-1)!;assert.equal(first.levels[0].bid,2200000);assert.equal(first.totals[0].bidCount,1);assert.equal(first.totals[0].bid,2200000);assert.equal(first.totals[3].bid,2200000);
  manager.setDemands([{...d,low:100,high:105}]);manager.pulse();assert.equal(frames.at(-1)!.levels.length,0);assert.deepEqual(frames.at(-1)!.totals,first.totals);
  now=2000;a.generation=2;emitProfileBook({key:'binance:BTC',type:'reset',continuous:true});for(let i=0;i<100&&manager.diagnostics().indexes.find(x=>x.key==='binance:BTC')?.generation!==2;i++)await new Promise(r=>setTimeout(r,10));manager.setDemands([d]);manager.pulse();assert.equal(frames.at(-1)!.levels[0].parts.binance?.bidObservedAt,1000);
  a.ready=false;emitProfileBook({key:'binance:BTC',type:'status'});assert.equal(frames.at(-1)!.levels[0].bid,1100000);b.ready=false;emitProfileBook({key:'coinbase:BTC',type:'status'});assert.equal(frames.at(-1)!.levels.length,0);assert.equal(frames.at(-1)!.totals[0].bid,null);
 }finally{manager.stop();}
});
test('pixel collisions select representatives without combining prices or changing top-three amounts',()=>{
 const levels=[{price:99,bid:1000000,ask:0},{price:98.99,bid:2000000,ask:0},{price:99.01,bid:0,ask:3000000}].map(v=>({...v,bidComplete:true,askComplete:true,parts:{}}));const pixels=profilePixelLevels(levels,()=>100.1);assert.equal(pixels.length,2);assert.equal(pixels.find(p=>p.side==='bid')!.level.bid,2000000);assert.equal(pixels.find(p=>p.side==='bid')!.count,2);assert.equal(largeOrderTop(levels,'bid').length,2);assert.equal(levels.reduce((s,l)=>s+l.bid,0),3000000);
});
