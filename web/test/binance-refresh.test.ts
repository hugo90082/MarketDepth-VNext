import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BinanceBookSession} from '../shared/binance-book';
import {binanceDepthStream} from '../shared/exchanges';
const snapshot=(id:number,bidEdge:number,askEdge:number)=>({lastUpdateId:id,bids:[[99.99,1],[bidEdge,2]],asks:[[100.01,1],[askEdge,2]]});
test('Binance spot depth uses the 100ms diff stream',()=>assert.match(binanceDepthStream('BTC'),/btcusdt@depth@100ms$/));
test('the first REST5000 snapshot initializes browser-observed coverage',()=>{
 const s=new BinanceBookSession();assert.equal(s.begin(),true);s.install(snapshot(10,99.5,100.5),1000);
 assert.equal(s.synchronized,true);assert.equal(s.book.id,10);assert.ok(s.coverage()!.bidBps<100);
 assert.equal(s.begin(),false);
});
test('valid outer deltas extend the observed local book',()=>{
 const s=new BinanceBookSession();s.begin();s.install(snapshot(10,99.5,100.5),1000);
 const before=s.coverage()!;s.receive({U:11,u:11,b:[[90,2]],a:[[110,2]]},2000);const after=s.coverage()!;
 assert.equal(s.book.id,11);assert.equal(s.book.at,2000);assert.equal(s.book.bids.get(90),2);assert.equal(s.book.asks.get(110),2);
 assert.ok(after.bidBps>before.bidBps);assert.ok(after.askBps>before.askBps);
 assert.deepEqual(s.book.snapshot(2000).map(pair=>pair.map(value=>value!==null)),Array.from({length:5},()=>[true,true]));
});
test('snapshot replays buffered diffs before exposing the book',()=>{
 const s=new BinanceBookSession();s.begin();s.receive({U:11,u:11,b:[],a:[]},1000);s.receive({U:12,u:12,b:[[99.99,3]],a:[]},1100);
 s.install(snapshot(10,98,103),1200);
 assert.equal(s.book.id,12);assert.equal(s.book.bids.get(99.99),3);
});

test('cancelled bootstrap stays unavailable; a real live sequence gap invalidates the book',()=>{
 const s=new BinanceBookSession();s.begin();s.install(snapshot(10,98,103),1000);s.receive({U:11,u:11,b:[],a:[]},2000);
 assert.equal(s.begin(),false);assert.notEqual(s.book.snapshot(2000)[0][0],null);
 assert.throws(()=>s.receive({U:13,u:13,b:[],a:[]},3000),/SEQUENCE_GAP/);assert.equal(s.book.ready,false);
 s.reset();s.begin();s.install(snapshot(13,99.5,100.5),4000);s.receive({U:14,u:14,b:[],a:[]},5000);
 assert.deepEqual(s.book.edges,[99.5,100.5]);
});

test('observed coverage headroom or fifteen minutes starts a refresh without dropping the live book',()=>{
 const s=new BinanceBookSession();s.begin();s.install(snapshot(10,98,102),1000);
 assert.equal(s.needsRefresh(1000+14*60_000),false);
 assert.equal(s.needsRefresh(1000+15*60_000),true);
 assert.equal(s.begin(1000+15*60_000),true);
 s.receive({U:11,u:11,b:[[99.98,3]],a:[]},2000);
 assert.equal(s.book.id,11,'live book stays current during REST');
 assert.equal(s.book.bids.get(99.98),3);
 s.install(snapshot(10,97,103),2500);
 assert.equal(s.book.id,11,'buffered diff bridges the new snapshot');
 assert.equal(s.book.bids.get(99.98),3);
 assert.deepEqual(s.book.edges,[97,103]);
});

test('headroom refresh uses the backend adaptive floor and failed refresh retains valid live data',()=>{
 const s=new BinanceBookSession();s.begin();s.install(snapshot(10,99.5,100.5),1000);
 s.receive({U:11,u:11,b:[[99.6,2],[99.99,0]],a:[[99.61,2],[100.01,0]]},2000);
 assert.equal(s.needsRefresh(7000),true,'observed bid side is near exhaustion');
 assert.equal(s.begin(7000),true);
 assert.throws(()=>s.install({lastUpdateId:12,bids:[],asks:[]},3000),/INVALID_BOOK/);
 assert.equal(s.book.ready,true);
 assert.equal(s.book.id,11);
});

test('a lost 0–100 bps side refreshes within five minutes without REST5000 hammering',()=>{
 const s=new BinanceBookSession();s.begin();s.install(snapshot(10,98.8,101.2),1000);
 // The live best prices moved towards the fixed snapshot bid edge. The old
 // 25% headroom floor would still wait for near-total depletion.
 s.receive({U:11,u:11,b:[[99.61,2],[99.99,0]],a:[[99.62,2],[100.01,0]]},2000);
 assert.ok(s.coverage()!.bidBps<100);
 assert.ok(s.coverage()!.bidBps>25);
 assert.equal(s.needsRefresh(1000+5*60_000-1),false);
 assert.equal(s.needsRefresh(1000+5*60_000),true);
 assert.equal(s.begin(1000+5*60_000),true);
 s.install(snapshot(11,98,102),1000+5*60_000+100);
 assert.ok(s.coverage()!.bidBps>=100);
 assert.equal(s.needsRefresh(1000+5*60_000+200),false);
});

test('a delayed sampling callback never includes Binance diffs received after its target',()=>{
 const s=new BinanceBookSession();s.begin();s.install(snapshot(10,98,102),1000);
 s.startCut(3000);
 s.receive({U:11,u:11,b:[[99.99,3]],a:[]},2999);
 s.receive({U:12,u:12,b:[[99.99,7]],a:[]},3020);
 const cut=s.finishCut(3000);
 assert.equal(cut.captured,true);
 assert.equal(cut.zones[0][0],99.99*3);
 assert.equal(s.book.snapshot(3020)[0][0],99.99*7);
});

test('a bootstrap before target joins the causal cut; a later sequence gap does not rewrite it',()=>{
 const s=new BinanceBookSession();s.begin();s.startCut(3000);
 s.receive({U:11,u:11,b:[[99.99,3]],a:[]},2000);
 s.install(snapshot(10,98,102),2500);
 assert.throws(()=>s.receive({U:13,u:13,b:[],a:[]},3020),/SEQUENCE_GAP/);
 const cut=s.finishCut(3000);
 assert.equal(cut.captured,true);
 assert.equal(cut.zones[0][0],99.99*3);
});

test('a sequence gap before target invalidates the causal cut',()=>{
 const s=new BinanceBookSession();s.begin();s.install(snapshot(10,98,102),1000);s.startCut(3000);
 assert.throws(()=>s.receive({U:12,u:12,b:[],a:[]},2500),/SEQUENCE_GAP/);
 const cut=s.finishCut(3000);
 assert.equal(cut.captured,false);
 assert.deepEqual(cut.zones[0],[null,null]);
});

test('a normal refresh retains sequenced outer levels but replaces prices inside each snapshot range',()=>{
 const s=new BinanceBookSession();s.begin();s.install(snapshot(10,99.5,100.5),1000);
 s.receive({U:11,u:11,b:[[90,2],[99.7,8]],a:[[110,2],[100.3,8]]},2000);
 assert.deepEqual(s.book.edges,[90,110]);
 assert.equal(s.begin(1000+15*60_000),true);
 s.install(snapshot(11,99.4,100.6),1000+15*60_000+100);
 assert.equal(s.book.bids.get(90),2);assert.equal(s.book.asks.get(110),2);
 assert.equal(s.book.bids.has(99.7),false);assert.equal(s.book.asks.has(100.3),false);
 assert.deepEqual(s.book.edges,[90,110]);
});

test('refresh replays buffered changes over retained outer levels without reviving deletions',()=>{
 const s=new BinanceBookSession();s.begin();s.install(snapshot(10,99.5,100.5),1000);
 s.receive({U:11,u:11,b:[[90,2],[89,3]],a:[[110,2]]},2000);
 assert.equal(s.begin(1000+15*60_000),true);
 s.receive({U:12,u:12,b:[[90,0],[88,4]],a:[[110,5]]},3000);
 s.install(snapshot(11,99.4,100.6),4000);
 assert.equal(s.book.id,12);
 assert.equal(s.book.bids.has(90),false);
 assert.equal(s.book.bids.get(89),3);assert.equal(s.book.bids.get(88),4);
 assert.equal(s.book.asks.get(110),5);
 assert.deepEqual(s.book.edges,[88,110]);
});

test('deleting the last observed outer level retracts coverage and its zones',()=>{
 const s=new BinanceBookSession();s.begin();s.install(snapshot(10,99.5,100.5),1000);
 s.receive({U:11,u:11,b:[[90,2]],a:[[110,2]]},2000);
 assert.equal(s.book.snapshot(2000)[4][0]!==null,true);
 s.receive({U:12,u:12,b:[[90,0]],a:[[110,0]]},3000);
 assert.deepEqual(s.book.edges,[99.5,100.5]);
 assert.equal(s.book.snapshot(3000)[4][0],null);
 assert.equal(s.book.snapshot(3000)[4][1],null);
});

test('many outer updates and periodic refreshes retain only live price levels',()=>{
 const s=new BinanceBookSession();s.begin();s.install(snapshot(10,99.5,100.5),1000);
 let id=10,oldBid=90,oldAsk=110;
 for(let cycle=0;cycle<3;cycle++){
  for(let i=0;i<2000;i++){
   const bid=90-(cycle*2000+i+1)/10000,ask=110+(cycle*2000+i+1)/10000;
   s.receive({U:++id,u:id,b:[[oldBid,0],[bid,2]],a:[[oldAsk,0],[ask,3]]},2000+cycle*900000+i);
   oldBid=bid;oldAsk=ask;
  }
  assert.equal(s.book.bids.size,3);
  assert.equal(s.book.asks.size,3);
  assert.equal(s.begin(s.lastSnapshotAt+15*60_000),true);
  s.install(snapshot(id,99.4,100.6),s.lastSnapshotAt+15*60_000+1);
  assert.equal(s.book.bids.get(oldBid),2);
  assert.equal(s.book.asks.get(oldAsk),3);
  assert.equal(s.book.bids.size,3);
  assert.equal(s.book.asks.size,3);
 }
});
