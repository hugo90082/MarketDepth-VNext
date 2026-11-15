import {test} from 'node:test';
import assert from 'node:assert/strict';
import {collectCoreRound} from '../src/runtime/core-round';
import {createRawBook,summarizeBook} from '../src/monitor/depth-engine/order-book';
import {researchBook} from '../shared/research-book';
import {preferredOwner,monitorPresence,nextCoreTarget} from '../shared/runtime-policy';
import {createReservationQueue} from '../shared/reservation-queue';
import {createAlertRuntime} from '../src/monitor/alert-runtime';
import {emptyAlert,DEFAULT_LEVELS} from '../src/monitor/depth-settings';
const target=1790587200000;
const book=(at=target)=>createRawBook({bids:[[99.9,3],[99.5,2],[98,4]],asks:[[100.1,2],[100.5,5],[102,3]],pair:'BTCUSD',quote:'USD',feed:'test',capturedAt:at});
const result=(exchange:string,at=target)=>({book:book(at),source:summarizeBook(exchange,book(at),at,()=>at)});
const settle=()=>new Promise<void>(resolve=>setImmediate(resolve));

test('research and monitoring derive USD from the same book; partial outer coverage stays explicit',()=>{
 const b=book(),r=researchBook(b),m=summarizeBook('Coinbase',b,target,()=>target);
 assert.equal(r.zones[0][0],99.9*3+99.5*2);assert.equal(r.zones[0][1],100.1*2+100.5*5);
 assert.equal(m.ranges['1'].bids,r.zones[0][0]);assert.equal(m.ranges['1'].asks,r.zones[0][1]);
 assert.equal(r.quality.complete[0],true);assert.equal(r.quality.complete[4],false);assert.deepEqual(r.zones[4],[null,null]);
 assert.equal(m.ranges['10'].status,'partial');
});
test('OKX and Bybit do not delay research sealing or another core asset; late data cannot rewrite a row',async()=>{
 let finish:()=>void=()=>{};const held=new Promise<void>(resolve=>{finish=resolve;});const messages:any[]=[];
 const run=collectCoreRound(target,new Set(['BTC','ETH','SOL']),async(exchange,asset)=>{
  if(asset==='BTC'&&(exchange==='OKX'||exchange==='Bybit'))await held;
  return result(exchange,asset==='BTC'&&exchange==='OKX'?target+5000:target);
 },m=>messages.push(m),()=>new Promise(()=>{}),()=>target);
 await settle();assert.equal(messages[0].type,'row');assert.ok(messages.some(m=>m.type==='snapshot'&&m.symbol==='ETH'));
 assert.ok(!messages.some(m=>m.type==='snapshot'&&m.symbol==='BTC'));
 const original=JSON.stringify(messages[0].row);finish();await run;
 assert.equal(JSON.stringify(messages[0].row),original);assert.match(messages.find(m=>m.symbol==='BTC').payload.sources.find((s:any)=>s.exchange==='OKX').feed,/取樣延遲/);
});
test('a research source arriving after the cut cannot backfill its old target',async()=>{
 let clock=target,finish:()=>void=()=>{},cut:()=>void=()=>{};const held=new Promise<void>(resolve=>{finish=resolve;});const deadline=new Promise<void>(resolve=>{cut=resolve;});const messages:any[]=[];
 const run=collectCoreRound(target,new Set(),async(exchange,asset)=>{if(exchange==='Kraken'&&asset==='BTC')await held;return result(exchange,clock);},m=>messages.push(m),()=>deadline,()=>clock);
 await settle();clock=target+1500;cut();await settle();assert.equal(messages[0].type,'row');assert.deepEqual(messages[0].row.d[2][0][0],[null,null]);
 clock=target+5000;finish();await run;assert.deepEqual(messages[0].row.d[2][0][0],[null,null]);
});
test('sleep recovery skips old targets and retains aligned 30-second scheduling',async()=>{
 let calls=0;await collectCoreRound(target,new Set(),async()=>{calls++;return result('Binance');},()=>{throw new Error('No invented sample');},async()=>{},()=>target+60000);
 assert.equal(calls,0);assert.equal(nextCoreTarget(target+60000)%30000,0);assert.equal(nextCoreTarget(target+60000),target+90000);
});
test('other asset background policy follows monitor visibility even if research leads',()=>{
 const peers=[{id:'research',monitor:false,visible:true,at:0},{id:'monitor',monitor:true,visible:false,at:0}];
 assert.equal(preferredOwner(peers),'research');assert.deepEqual(monitorPresence(peers),{active:true,visible:false,soundOwner:'monitor'});
});
test('core reservations jump pending ordinary work without breaking exchange spacing or Retry-After',async()=>{
 const state={nextAllowedAt:Date.now()+20,blockedUntil:0},reserve=createReservationQueue(state),order:string[]=[];
 const normal=reserve(20,0).then(()=>order.push('ordinary'));const core=reserve(20,1).then(()=>order.push('core'));
 await Promise.all([normal,core]);assert.deepEqual(order,['core','ordinary']);
 const before=Date.now();state.blockedUntil=before+30;await reserve(1,1);assert.ok(Date.now()>=before+30);
});
test('alert ownership transfer retains threshold arming, repeat clock and accepted snapshots',()=>{
 let clock=target;const entries:any[]=[];
 const options={getLevels:()=>DEFAULT_LEVELS,isLeader:()=>true,channelsEnabled:()=>false,onLog:(entry:any)=>entries.push(entry),playSound(){},sendNotification(){},now:()=>clock};
 const first=createAlertRuntime(options),config={...emptyAlert(),enabled:true};
 first.acceptSnapshot('BTC',target);first.evaluate('BTC',0.9,1,0,config,10);const count=entries.length;
 const next=createAlertRuntime(options);next.restore(first.checkpoint());assert.equal(next.acceptSnapshot('BTC',target),false);
 clock+=30000;next.evaluate('BTC',0.9,1,0,config,10);assert.equal(entries.length,count);
 clock+=30000;next.evaluate('BTC',0.9,1,0,config,10);assert.ok(entries.length>count);
});
