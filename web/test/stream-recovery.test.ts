import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRawBook,summarizeBook} from '../src/monitor/depth-engine/order-book';
const flush=async()=>{for(let i=0;i<30;i++)await new Promise<void>(resolve=>setImmediate(resolve));};

test('core books bootstrap before sampling, reuse one snapshot each and recover gaps without the next round',async context=>{
 const originalFetch=globalThis.fetch,originalSocket=globalThis.WebSocket;
 context.mock.timers.enable({apis:['Date','setTimeout','setInterval'],now:1790936970000});
 const requests:string[]=[],sockets:Socket[]=[],subscriptions:any[]=[];
 class Socket {
  static OPEN=1;static CLOSING=2;static CLOSED=3;
  readyState=1;closed=false;onopen:(()=>void)|null=null;onmessage:((e:{data:string})=>void)|null=null;onclose:(()=>void)|null=null;onerror:unknown;
  constructor(public url:string){sockets.push(this);queueMicrotask(()=>{this.onopen?.();if(url.includes('binance.vision'))this.emit({e:'depthUpdate',U:100,u:101,b:[['99.9','3']],a:[['100.1','4']]});});}
  emit(data:unknown){this.onmessage?.({data:JSON.stringify(data)});}
  send(value:string){subscriptions.push(JSON.parse(value));}
  close(){this.closed=true;this.readyState=3;this.onclose?.();}
 }
 globalThis.fetch=async input=>{
  const url=String(input);
  if(url.startsWith('/api/market-selections')){const symbol=new URL(url,'https://test').searchParams.get('symbol')!;return Response.json({symbol,selections:{Binance:{market:{pair:symbol+'USDT',quote:'USDT'}},Coinbase:{market:symbol==='MISSING'?null:{pair:symbol+'-USD',quote:'USD'}}}});}
  if(url.includes('exchange.coinbase.com/products'))return Response.json({bids:[[99,1],[95,2]],asks:[[101,1],[105,2]]});
  requests.push(url);return Response.json({lastUpdateId:100,bids:[['99.9','1'],['95','2']],asks:[['100.1','2'],['105','1']]});
 };
 Object.defineProperty(globalThis,'WebSocket',{value:Socket,writable:true,configurable:true});
 const books=await import('../src/runtime/books'),adapter=await import('../src/monitor/browser-depth-worker');
 try {
  books.startBooks();await flush();
  for(let i=0;i<9;i++){context.mock.timers.tick(1000);await flush();}
  assert.equal(requests.length,3,'all three initial snapshots precede the aligned round');
  for(const asset of ['BTC','ETH','SOL'])assert.ok(adapter.isBinanceStreamReady(asset));
  const target=1790937000000;context.mock.timers.tick(target-Date.now());
  const {collectCoreRound}=await import('../src/runtime/core-round');const messages:any[]=[];
  await collectCoreRound(target,new Set(),async(exchange,symbol)=>{
   if(exchange==='Binance')return books.acquire(exchange,symbol);
   const book=createRawBook({bids:[[99,1],[95,2]],asks:[[101,1],[105,2]],pair:symbol+'USD',quote:'USD',feed:'mock',capturedAt:Date.now()});
   return {book,source:summarizeBook(exchange,book,Date.now())};
  },m=>messages.push(m),()=>new Promise(()=>{}));
  assert.deepEqual(messages[0].row.captured[0],[true,true,true]);assert.equal(requests.length,3,'sampling does not recreate REST bootstraps');
  const old=sockets.find(s=>s.url.includes('btcusdt@depth'))!;
  old.emit({e:'depthUpdate',U:999,u:999,b:[],a:[]});await flush();
  assert.equal(old.closed,true);assert.equal(requests.length,4,'gap recovery starts immediately, before the next sample');
  old.emit({e:'depthUpdate',U:102,u:102,b:[['99.9','999']],a:[]});
  const recovered=await books.acquire('Binance','BTC');assert.equal(recovered.book?.bids[0][1],3,'closed generation cannot alter its replacement');
  assert.equal(requests.length,4);assert.ok(adapter.isBinanceStreamReady('BTC'));
  const cb=sockets.find(s=>s.url.endsWith('/api/coinbase-stream'))!;
  assert.ok(cb,'the shared Coinbase connection uses the same-origin Sites relay');assert.equal(sockets.some(s=>s.url.includes('ws-feed.exchange.coinbase.com')),false,'no parallel direct exchange stream');
  cb.emit({type:'snapshot',product_id:'BTC-USD',bids:[['99','1'],['95','2']],asks:[['101','1'],['105','2']]});
  const before=requests.length;assert.equal((await books.acquire('Coinbase','MISSING')).source.status,'unsupported');assert.equal((await books.acquire('Coinbase','MISSING')).source.status,'unsupported');assert.equal(requests.length,before,'confirmed missing products never request a depth backup');
  const firstBad=books.acquire('Coinbase','BAD');await flush();context.mock.timers.tick(2000);await flush();await firstBad;
  const beforeBad=subscriptions.filter(s=>s.type==='subscribe'&&s.product_ids.includes('BAD-USD')).length;
  cb.emit({type:'error',product_id:'BAD-USD',message:'Unsupported product BAD-USD'});
  const nextBad=books.acquire('Coinbase','BAD');await flush();context.mock.timers.tick(2000);await flush();await nextBad;
  assert.equal(cb.closed,false,'individual rejection leaves the shared core connection alive');
  assert.equal(subscriptions.filter(s=>s.type==='subscribe'&&s.product_ids.includes('BAD-USD')).length,beforeBad,'rejected products are not subscribed repeatedly');
  assert.ok((await books.acquire('Coinbase','BTC')).book);
 } finally {books.stopBooks();globalThis.fetch=originalFetch;Object.defineProperty(globalThis,'WebSocket',{value:originalSocket,writable:true,configurable:true});context.mock.timers.reset();}
});
