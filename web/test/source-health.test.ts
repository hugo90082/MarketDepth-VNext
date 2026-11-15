import {test} from 'node:test';
import assert from 'node:assert/strict';
const flush=async()=>{for(let i=0;i<20;i++)await new Promise<void>(r=>setImmediate(r));};

test('partial OKX remains usable; Bybit preserves fallback order; prepared Bitfinex and Kraken obey core permits and Retry-After',async context=>{
 const originalFetch=globalThis.fetch,originalSocket=globalThis.WebSocket;
 context.mock.timers.enable({apis:['Date','setTimeout'],now:1790937000000});
 const requests:{url:string;at:number}[]=[],sockets:Socket[]=[],subscriptions:any[]=[];
 let rateLimit=false;
 class Socket{
  static OPEN=1;static CLOSING=2;readyState=1;onopen:(()=>void)|null=null;onerror:(()=>void)|null=null;onclose:(()=>void)|null=null;onmessage:((e:{data:string})=>void)|null=null;
  constructor(public url:string){sockets.push(this);queueMicrotask(()=>this.onopen?.());}
  send(value:string){const message=JSON.parse(value);subscriptions.push(message);queueMicrotask(()=>{if(this.url.includes('bybit'))this.close();else this.onmessage?.({data:JSON.stringify([1,[[99,1,2],[90,1,1],[101,1,-3],[110,1,-1]]])});});}
  close(){if(this.readyState===3)return;this.readyState=3;this.onclose?.();}
 }
 globalThis.fetch=async input=>{
  const url=String(input);
  if(url.startsWith('/api/market-selections')){const symbol=new URL(url,'https://test').searchParams.get('symbol')!;return Response.json({symbol,selections:Object.fromEntries(['OKX','Bybit','Bitfinex','Kraken'].map(exchange=>[exchange,{market:{pair:symbol+(exchange==='OKX'?'-USDT':exchange==='Bybit'?'USDT':'USD'),quote:['OKX','Bybit'].includes(exchange)?'USDT':'USD',tickSize:0.01}}]))});}
  requests.push({url,at:Date.now()});
  if(url.includes('okx')){if(rateLimit){rateLimit=false;return new Response('',{status:429,headers:{'Retry-After':'2'}});}return Response.json({code:'0',data:[{bids:[[99.9,2],[99,1]],asks:[[100.1,3],[101,1]]}]});}
  if(url.includes('full_orderbook'))return Response.json({retCode:10001,retMsg:'full endpoint unavailable'});
  if(url.includes('api.bybit'))return Response.json({retCode:0,result:{b:[[99,2],[90,1]],a:[[101,3],[110,1]]}});
  if(url.includes('kraken'))return Response.json({error:[],result:{bids:[{price:99,qty:2},{price:90,qty:1}],asks:[{price:101,qty:3},{price:110,qty:1}]}});
  throw new Error('Unexpected request '+url);
 };
 Object.defineProperty(globalThis,'WebSocket',{value:Socket,writable:true,configurable:true});
 const adapter=await import('../src/monitor/browser-depth-worker');
 async function complete<T>(promise:Promise<T>,_ms=1500){let done=false,result:T|undefined,error:unknown;void promise.then(v=>{result=v;done=true;},e=>{error=e;done=true;});for(let i=0;i<120&&!done;i++){await flush();if(!done)context.mock.timers.tick(250);}await flush();if(!done)throw new Error('Mock source did not settle');if(error)throw error;return result!;}
 try{
  const okx=await complete(adapter.loadBrowserSource('OKX','BTC',5000,new AbortController().signal));assert.equal(okx.source.ranges['10'].status,'partial');assert.ok(okx.source.ranges['10'].bids>0);
  const bybit=await complete(adapter.loadBrowserSource('Bybit','BTC',5000,new AbortController().signal));assert.match(bybit.source.feed,/REST 1000/);assert.match(bybit.source.fallbackReason!,/斷線/);assert.deepEqual(requests.filter(r=>r.url.includes('api.bybit')).map(r=>r.url.includes('full_orderbook')?'full':'rest'),['full','rest']);
  const target=Date.now()+10000;await adapter.prepareCoreSources(target);const prepared=sockets.filter(s=>s.url.includes('bitfinex')).length;assert.equal(prepared,3);assert.equal(subscriptions.filter(s=>s.event==='subscribe').length,0,'preparation does not capture a premature snapshot');
  context.mock.timers.tick(target-1500-Date.now());const signal=new AbortController().signal;adapter.prioritizeSource(signal);
  const bitfinex=await complete(adapter.loadBrowserSource('Bitfinex','BTC',5000,signal),100);assert.match(bitfinex.source.feed,/P2 250/);assert.equal(sockets.filter(s=>s.url.includes('bitfinex')).length,prepared,'sampling consumes its prepared connection');assert.equal(subscriptions.find(s=>s.event==='subscribe').prec,'P2');
  const kraken=await complete(adapter.loadBrowserSource('Kraken','BTC',5000,signal));assert.match(kraken.source.feed,/GroupedBook/);await complete(adapter.loadBrowserSource('Kraken','BTC',5000,signal));assert.match(requests.filter(r=>r.url.includes('kraken')).at(-1)!.url,/grouping=25$/,'the next snapshot uses the dynamic grouping');
  rateLimit=true;await assert.rejects(complete(adapter.loadBrowserSource('OKX','ETH',5000,signal)),/429/);const limitedAt=requests.at(-1)!.at;const before=requests.length;const retry=adapter.loadBrowserSource('OKX','SOL',5000,signal);await flush();context.mock.timers.tick(1900);await flush();assert.equal(requests.length,before);context.mock.timers.tick(100);await flush();await retry;assert.ok(requests.at(-1)!.at>=limitedAt+2000);
 }finally{adapter.stopPreparedSources();globalThis.fetch=originalFetch;Object.defineProperty(globalThis,'WebSocket',{value:originalSocket,writable:true,configurable:true});context.mock.timers.reset();}
});
