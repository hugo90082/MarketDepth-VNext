import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {RawBook} from '../src/monitor/depth-engine/order-book';
test('a completed Binance bootstrap detaches its request deadline and reuses the synchronized stream next round',async()=>{
 const originalFetch=globalThis.fetch,originalSocket=globalThis.WebSocket;
 let requests=0;const sockets:Socket[]=[];
 class Socket{
  onmessage:((event:{data:string})=>void)|null=null;onclose:(()=>void)|null=null;onerror:unknown;closed=false;
  constructor(){sockets.push(this);queueMicrotask(()=>this.onmessage?.({data:JSON.stringify({e:'depthUpdate',U:100,u:101,E:Date.now(),b:[['99.9','3']],a:[['100.1','4']]})}));}
  close(){this.closed=true;this.onclose?.();}
 }
 globalThis.fetch=async input=>{
  if(String(input).startsWith('/api/market-selections'))return Response.json({symbol:'BTC',selections:{Binance:{market:{pair:'BTCUSDT',quote:'USDT',tickSize:0}}}});
  requests++;return Response.json({lastUpdateId:100,bids:[['99.9','1'],['95','2']],asks:[['100.1','2'],['105','1']]});
 };
 Object.defineProperty(globalThis,'WebSocket',{value:Socket,writable:true,configurable:true});
 try{
  const {loadBrowserSource}=await import('../src/monitor/browser-depth-worker');
  const deadline=new AbortController();const first=await loadBrowserSource('Binance','BTC',5000,deadline.signal);
  assert.ok((first.source as typeof first.source&{rawBook?:RawBook}).rawBook);assert.match(first.source.feed,/Diff WebSocket/);
  deadline.abort();assert.equal(sockets[0].closed,false,'round deadline must not close a healthy persistent book');
  const second=await loadBrowserSource('Binance','BTC',5000,new AbortController().signal);
  assert.equal(requests,1);assert.equal(sockets.length,1);assert.equal((second.source as typeof second.source&{rawBook:RawBook}).rawBook.bids[0][1],3);
  sockets[0].onmessage?.({data:JSON.stringify({e:'depthUpdate',U:999,u:999,E:Date.now(),b:[],a:[]})});
  assert.equal(sockets[0].closed,true,'a real sequence gap still invalidates the stream');
 }finally{globalThis.fetch=originalFetch;Object.defineProperty(globalThis,'WebSocket',{value:originalSocket,writable:true,configurable:true});}
});

test('the shared Binance adapter refreshes REST5000 without closing the stream or losing sequenced outer levels',async()=>{
 const originalFetch=globalThis.fetch,originalSocket=globalThis.WebSocket,originalNow=Date.now;
 let now=originalNow()+60_000,requests=0,resolveRefresh:((value:Response)=>void)|undefined;
 const sockets:Socket[]=[];
 class Socket{
  onmessage:((event:{data:string})=>void)|null=null;onclose:(()=>void)|null=null;onerror:unknown;closed=false;
  constructor(){sockets.push(this);queueMicrotask(()=>this.emit(100,101,[['99.9','3']],[['100.1','4']]));}
  emit(U:number,u:number,b:string[][]=[],a:string[][]=[]){this.onmessage?.({data:JSON.stringify({e:'depthUpdate',U,u,b,a})});}
  close(){this.closed=true;this.onclose?.();}
 }
 Date.now=()=>now;
 globalThis.fetch=async input=>{
  if(String(input).startsWith('/api/market-selections'))return Response.json({symbol:'BTC',selections:{Binance:{market:{pair:'BTCUSDT',quote:'USDT',tickSize:0}}}});
  requests++;
  if(requests===1)return Response.json({lastUpdateId:100,bids:[['99.9','1'],['95','2']],asks:[['100.1','2'],['105','1']]});
  return new Promise<Response>(resolve=>{resolveRefresh=resolve;});
 };
 Object.defineProperty(globalThis,'WebSocket',{value:Socket,writable:true,configurable:true});
 const {loadBrowserSource,stopBinanceStreams}=await import('../src/monitor/browser-depth-worker');
 const {observeProfileBooks,setProfileBookInterest,readProfileBook}=await import('../shared/profile-books');const events:any[]=[];setProfileBookInterest(['binance:BTC']);const unobserve=observeProfileBooks(e=>events.push(e));
 const raw=(result:Awaited<ReturnType<typeof loadBrowserSource>>)=>(result.source as typeof result.source&{rawBook:RawBook}).rawBook;
 try{
  stopBinanceStreams();
  await loadBrowserSource('Binance','BTC',5000,new AbortController().signal);
  assert.equal(readProfileBook('binance:BTC')?.ready,true);
  const before=events.length;sockets[0].emit(100,101,[['99.9','999']]);assert.equal(events.length,before,'obsolete sequence cannot update the profile');
  sockets[0].emit(102,102,[['92.5','7']],[['107.5','8']]);
  now+=15*60_000;sockets[0].emit(103,103);
  const during=raw(await loadBrowserSource('Binance','BTC',5000,new AbortController().signal));
  assert.ok(during.bids.some(([p,q])=>p===92.5&&q===7),'sampling continues from the live book while REST refreshes');
  for(let i=0;i<5&&!resolveRefresh;i++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(requests,2,'a healthy stream still refreshes its old REST5000 snapshot');
  assert.equal(sockets.length,1);assert.equal(sockets[0].closed,false);
  sockets[0].emit(104,104,[['92.5','9']],[['107.5','0']]);
  resolveRefresh!(Response.json({lastUpdateId:103,bids:[['99.8','5'],['97','2']],asks:[['100.2','6'],['103','1']]}));
  for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));
  const after=raw(await loadBrowserSource('Binance','BTC',5000,new AbortController().signal));
  assert.ok(after.bids.some(([p,q])=>p===92.5&&q===9),'outer updates survive the atomic snapshot swap');
  assert.ok(!after.bids.some(([p])=>p===99.9),'the new snapshot owns the inner interval');
  assert.ok(!after.asks.some(([p])=>p===107.5),'buffered deletions are not revived');
  assert.equal(sockets.length,1);assert.equal(requests,2);
  now+=15*60_000;sockets[0].emit(105,105);
  await loadBrowserSource('Binance','BTC',5000,new AbortController().signal);
  for(let i=0;i<5&&requests<3;i++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(requests,3);
  resolveRefresh!(new Response('refresh failed',{status:503}));
  for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));
  const failed=raw(await loadBrowserSource('Binance','BTC',5000,new AbortController().signal));
  assert.ok(failed.bids.some(([p,q])=>p===92.5&&q===9));
  assert.equal(sockets[0].closed,false,'refresh failure retains the healthy stream');
  assert.equal(requests,3,'failed refresh does not immediately hammer REST');
  now+=60_000;sockets[0].emit(106,106);
  await loadBrowserSource('Binance','BTC',5000,new AbortController().signal);
  for(let i=0;i<5&&requests<4;i++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(requests,4);stopBinanceStreams();
  resolveRefresh!(Response.json({lastUpdateId:106,bids:[['99.8','50'],['90','2']],asks:[['100.2','60'],['110','1']]}));
  for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));
  const {isBinanceStreamReady}=await import('../src/monitor/browser-depth-worker');
  assert.equal(isBinanceStreamReady('BTC'),false,'late refresh cannot resurrect a stopped leader book');
  const closedCount=events.length;sockets[0].emit(107,107,[['99.8','999']]);assert.equal(events.length,closedCount);assert.equal(readProfileBook('binance:BTC')?.ready,false);
 }finally{unobserve();setProfileBookInterest([]);stopBinanceStreams();Date.now=originalNow;globalThis.fetch=originalFetch;Object.defineProperty(globalThis,'WebSocket',{value:originalSocket,writable:true,configurable:true});}
});
