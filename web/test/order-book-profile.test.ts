import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ProfileIndex} from '../src/runtime/profile-index';
import {ProfileManager} from '../src/runtime/profiles';
import {CoinbaseLiveBook} from '../shared/live-books';
import {createRawBook} from '../src/monitor/depth-engine/order-book';
import {registerProfileBook,emitProfileBook,type ProfileBookView} from '../shared/profile-books';
import {profileGrid,profileTop,formatMillions,profileKey,commonProfileTick,type ProfileBin,type ProfileFrame} from '../shared/order-book-profile';
const view=(bids:[number,number][],asks:[number,number][]):ProfileBookView=>({bids:new Map(bids),asks:new Map(asks),ready:true,activityAt:1000,updateAt:1000,snapshotAt:1000,tick:.01,complete:true});
const idle=()=>new Promise(r=>setTimeout(r,30));
async function built(manager:ProfileManager,key:string){for(let i=0;i<100&&!manager.diagnostics().indexes.find(x=>x.key===key)?.ready;i++)await idle();assert.ok(manager.diagnostics().indexes.find(x=>x.key===key)?.ready);}
test('index overwrites quantities, removes zero, replays updates during segmented rebuild',async()=>{
 const index=new ProfileIndex(),book=view([[100,2],[99,3]],[[101,4]]);
 const task=index.rebuild(book);index.patch([{side:'bid',price:100,old:2,qty:5}]);await task;
 assert.equal(index.ranges(99,3,1,1).bid[1],500);
 index.patch([{side:'bid',price:100,old:5,qty:0},{side:'ask',price:101,old:4,qty:2}]);
 assert.deepEqual([...index.ranges(99,3,1,1).bid],[297,0,0]);assert.equal(index.ranges(99,3,1,1).ask[2],202);
 assert.equal(index.midpoint(),100);
 const second=index.rebuild(view([[99,3]],[[101,2]]));index.patch([{side:'bid',price:99,old:3,qty:4},{side:'bid',price:99,old:4,qty:7}]);await second;
 assert.equal(index.ranges(99,1,1,1).bid[0],693);assert.equal(index.dirty,1);
});
test('price cells use half-open tick boundaries and clip the visible window',async()=>{
 const index=new ProfileIndex();await index.rebuild(view([[.3,10],[.4,10],[.5,10]],[[.6,10]]));
 assert.deepEqual([...index.ranges(3,3,1,.1).bid].map(x=>Math.round(x)),[3,4,5]);
 assert.deepEqual([...index.ranges(3,3,1,.1,.35,.5).bid].map(x=>Math.round(x)),[0,4,0]);
 const g=profileGrid(.1,160.1,1280,1);assert.ok(g.end-g.start<=160);assert.ok(g.end*g.step>=160.1);
 assert.equal(commonProfileTick([.05,.02]),.01);assert.equal(commonProfileTick([.0001,.001]),.0001);
});
test('Top 3 uses unrounded million threshold and side-specific ties',()=>{
 const bins=[999999.99,1000000,1100000,1100000,1100000,900000].map((amount,i)=>({low:i,high:i+1,bid:amount,ask:amount,bidComplete:true,askComplete:true,parts:{}})) as ProfileBin[];
 assert.deepEqual(profileTop(bins,'bid').map(b=>b.low),[4,3,2]);assert.deepEqual(profileTop(bins,'ask').map(b=>b.low),[2,3,4]);
 assert.deepEqual(profileTop(bins.slice(0,2),'bid').map(b=>b.low),[1]);assert.equal(formatMillions(1e6),'1M');assert.equal(formatMillions(11400000),'11.4M');assert.equal(formatMillions(21e6),'21M');
});
test('Coinbase only emits applied updates; replaces, deletes and preserves market timestamps',()=>{
 const events:any[]=[],book=new CoinbaseLiveBook((type,patches)=>events.push({type,patches}));
 book.update({type:'snapshot',bids:[['100','2']],asks:[['101','3']]},10);
 book.update({type:'l2update',changes:[['buy','100','5'],['buy','100','0']]},20);
 assert.equal(book.view().bids.has(100),false);assert.deepEqual(events[1].patches.map((p:any)=>[p.old,p.qty]),[[2,5],[5,0]]);
 book.heartbeat(30);assert.equal(book.at,30);assert.equal(book.updateAt,20);assert.equal(book.snapshotAt,10);
 assert.throws(()=>book.update({type:'l2update',changes:[['bad','100','1']]},40));assert.equal(events.length,2);
});
test('manager deduplicates views, drops failed source immediately, stops hidden demands, bounds cache',async()=>{
 let now=1000;const binance=view([[99,20000]],[[101,20000]]),coinbase=view([[98,20000]],[[102,20000]]);binance.complete=false;binance.bounds={bid:99,ask:101};
 registerProfileBook('binance:BTC',()=>binance);registerProfileBook('coinbase:BTC',()=>coinbase);
 const frames:ProfileFrame[]=[],manager=new ProfileManager(f=>frames.push(f),()=>now);
 const demand={id:'one',revision:1,asset:'BTC' as const,mode:'all4' as const,low:97,high:103,height:800};
 manager.setDemands([demand,{...demand,id:'two'}]);await built(manager,'binance:BTC');await built(manager,'coinbase:BTC');manager.pulse();
 assert.equal(frames.at(-1)!.sources.filter(s=>s.available).length,2);assert.equal(manager.diagnostics().cache,1);
 const total=frames.at(-1)!.levels.reduce((sum,b)=>sum+b.bid+b.ask,0);assert.equal(total,8000000);
 binance.ready=false;emitProfileBook({key:'binance:BTC',type:'status'});
 const frame=frames.at(-1)!;assert.equal(frame.sources.filter(s=>s.available).length,1);assert.equal(frame.levels.reduce((sum,b)=>sum+b.bid+b.ask,0),4000000);assert.ok(frame.levels.some(b=>!b.bidComplete));
 for(let i=0;i<40;i++){manager.setDemands([{...demand,low:90+i,high:105+i}]);manager.pulse();}assert.ok(manager.diagnostics().cache<=24);
 manager.setDemands([]);const before=frames.length;now+=1000;manager.pulse();assert.equal(frames.length,before);assert.equal(manager.diagnostics().indexes.length,9);manager.stop();
});
test('same grouping with different clipped boundaries has a distinct computation key',()=>{
 const d={id:'x',revision:1,asset:'BTC' as const,mode:'binance' as const,low:99.11,high:101.11,height:100};assert.notEqual(profileKey(d,.01),profileKey({...d,low:99.12},.01));
});
test('range queries never traverse or clone the live maps',async()=>{
 const book=view(Array.from({length:10000},(_,i)=>[100+i*.01,1] as [number,number]),[[300,1]]),index=new ProfileIndex();await index.rebuild(book);
 const forbid=()=>{throw new Error('full live-book traversal');};(book.bids as Map<number,number>)[Symbol.iterator]=forbid;(book.asks as Map<number,number>)[Symbol.iterator]=forbid;
 for(let second=0;second<60;second++)assert.ok(index.ranges(100,160,10,.01).bid.length===160);
});
test('20,000 distinct corrections rebuild from the existing book, without I/O',async()=>{
 const book=view(Array.from({length:20000},(_,i)=>[100+i*.001,1] as [number,number]),[[150,1]]);book.tick=.001;registerProfileBook('coinbase:ETH',()=>book);
 const manager=new ProfileManager(()=>{},()=>1000);manager.setDemands([{id:'stress',revision:1,asset:'ETH',mode:'coinbase',low:100,high:120,height:600}]);
 await built(manager,'coinbase:ETH');
 const patches=[...book.bids].map(([price])=>({side:'bid' as const,price,old:1,qty:2}));for(const p of patches)(book.bids as Map<number,number>).set(p.price,p.qty);
 emitProfileBook({key:'coinbase:ETH',type:'patch',patches});for(let i=0;i<100&&manager.diagnostics().indexes.find(x=>x.key==='coinbase:ETH')!.rebuilds<2;i++)await idle();assert.equal(manager.diagnostics().indexes.find(x=>x.key==='coinbase:ETH')!.rebuilds,2);
 for(let i=0;i<100&&manager.diagnostics().indexes.find(x=>x.key==='coinbase:ETH')!.building;i++)await idle();assert.equal(manager.diagnostics().indexes.find(x=>x.key==='coinbase:ETH')!.dirty,0);manager.stop();
});
test('an old fallback retains its capture time and never becomes a new live source',async()=>{
 const frames:ProfileFrame[]=[],book=view([[99,1]],[[101,1]]);book.ready=false;registerProfileBook('coinbase:SOL',()=>book);let now=2000;
 const manager=new ProfileManager(frame=>frames.push(frame),()=>now);manager.setDemands([{id:'fallback',revision:1,asset:'SOL',mode:'coinbase',low:98,high:102,height:600}]);
 manager.rebase('Coinbase','SOL',createRawBook({bids:[[99,1]],asks:[[101,1]],pair:'SOL-USD',quote:'USD',feed:'REST',capturedAt:1000,tickSize:.01,acquisitionMode:'official-api'}));
 await idle();manager.pulse();assert.equal(frames.at(-1)?.sources[0].activityAt,1000);assert.equal(frames.at(-1)?.sources[0].fallback,true);
 emitProfileBook({key:'coinbase:SOL',type:'status'});assert.equal(frames.at(-1)?.sources[0].available,false,'a stream failure never revives an earlier fallback contribution');
 manager.rebase('Coinbase','SOL',createRawBook({bids:[[99,1]],asks:[[101,1]],pair:'SOL-USD',quote:'USD',feed:'REST',capturedAt:1000,tickSize:.01,acquisitionMode:'official-api'}));await idle();
 now=62001;manager.pulse();assert.equal(frames.at(-1)?.sources[0].available,false);assert.equal(frames.at(-1)?.sources[0].activityAt,1000);assert.equal(frames.at(-1)?.max,0);manager.stop();
});
