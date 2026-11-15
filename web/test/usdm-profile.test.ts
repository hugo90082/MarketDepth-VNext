import {test} from 'node:test';
import assert from 'node:assert/strict';
import {UsdmBook,type UsdmDiff} from '../shared/usdm-book';
import {UsdmCollector} from '../src/runtime/usdm';
import {UsdmRest,UsdmHttpError} from '../shared/usdm-rest';
import {ProfileManager} from '../src/runtime/profiles';
import {bookKey,registerProfileBook,emitProfileBook,readProfileBook,profileBookInterested,type ProfileBookView} from '../shared/profile-books';
import {ASSETS} from '../shared/model';
const snapshot=(id=100)=>({lastUpdateId:id,bids:[['99','2'],['98','3']] as [string,string][],asks:[['101','4'],['102','5']] as [string,string][]});
const diff=(U=100,u=101,pu=99,b:[string,string][]=[['99','5']],a:[string,string][]=[]):UsdmDiff=>({e:'depthUpdate',s:'BTCUSDT',U,u,pu,b,a,E:200,T:199});
const sleep=(ms=20)=>new Promise(r=>setTimeout(r,ms));
async function until(predicate:()=>boolean){for(let i=0;i<200&&!predicate();i++)await sleep();assert.ok(predicate());}
test('USDM bridges snapshot ID inclusively, enforces pu, overwrites/deletes and preserves last valid data',()=>{
 const book=new UsdmBook();assert.equal(book.install(snapshot(),[{data:diff(),at:10}],20),true);assert.equal(book.id,101);assert.equal(book.bids.get(99),5);assert.equal(book.eventAt,199);
 book.receive(diff(102,105,101,[['99','1'],['98','0']]),30);assert.equal(book.bids.get(99),1);assert.equal(book.bids.has(98),false);
 assert.deepEqual(book.receive(diff(100,101,99),40),[]);assert.equal(book.updateAt,30);
 assert.throws(()=>book.receive(diff(106,108,104),40),/SEQUENCE_GAP/);book.invalidate();assert.equal(book.bids.get(99),1);assert.equal(book.ready,false);
 const equal=new UsdmBook();assert.ok(equal.install(snapshot(),[{data:diff(98,100,97),at:1}],2));assert.equal(equal.id,100);
 assert.throws(()=>new UsdmBook().install(snapshot(),[{data:diff(101,102,100),at:1}],2),/TOO_OLD/);
 assert.equal(new UsdmBook().install(snapshot(105),[{data:diff(),at:1}],2),false);
});
test('healthy refresh retains continuously sequenced outer prices, deletes stay deleted and failed staging is atomic',()=>{
 const book=new UsdmBook();book.install(snapshot(),[{data:diff(),at:1}],2);book.receive(diff(102,102,101,[['80','9'],['79','4']],[['120','8']]),3);
 book.receive(diff(103,103,102,[['79','0']]),4);
 const fresh={lastUpdateId:102,bids:[['99','7']] as [string,string][],asks:[['101','8']] as [string,string][]};
 book.install(fresh,[{data:diff(102,102,101,[['80','9'],['79','4']],[['120','8']]),at:3},{data:diff(103,103,102,[['79','0']]),at:4}],5,true);
 assert.equal(book.bids.get(80),9);assert.equal(book.bids.has(79),false);assert.equal(book.bids.get(98),3);assert.equal(book.bids.get(99),7);
 assert.deepEqual(book.bounds,{bid:98,ask:102},'sparse outer diffs never expand confirmed coverage');const before=[...book.bids],generation=book.generation;
 assert.throws(()=>book.install(fresh,[{data:diff(102,102,101),at:3},{data:diff(105,106,104),at:4}],6,true),/SEQUENCE_GAP/);assert.deepEqual([...book.bids],before);assert.equal(book.generation,generation);assert.equal(book.ready,true);
});
test('more than 100,000 live prices survive; sub-1% coverage does not cause a fixed five-minute refresh loop',()=>{
 const book=new UsdmBook();book.install(snapshot(),[{data:diff(),at:1}],2);
 const levels=Array.from({length:100001},(_,i)=>[String(1+i*.0001),'1'] as [string,string]);book.receive(diff(102,102,101,levels),3);assert.ok(book.bids.size>100000);
 book.lastRefreshAttempt=2;assert.equal(book.needsRefresh(5*60000),false);assert.equal(book.needsRefresh(15*60000+2),true);book.lastRefreshAttempt=15*60000+2;assert.equal(book.needsRefresh(15*60000+59000),false);
});
test('nine indexes stay warm across zero visible demands and both markets stay isolated',async()=>{
 let now=1000;const views=new Map<string,ProfileBookView>();for(const asset of ASSETS)for(const [source,market]of [['binance','spot'],['coinbase','spot'],['binance','usdm']] as const){const key=bookKey(source,asset,market),book={bids:new Map([[99,market==='usdm'?70000:20000]]),asks:new Map([[101,40000]]),ready:true,activityAt:now,updateAt:now,snapshotAt:now,tick:1,complete:true,generation:1};views.set(key,book);registerProfileBook(key,()=>book);}
 const frames:any[]=[],manager=new ProfileManager(f=>frames.push(f),()=>now);manager.setDemands([]);await until(()=>manager.diagnostics().indexes.every(i=>i.ready));assert.equal(manager.diagnostics().indexes.length,9);
 const rebuilds=manager.diagnostics().indexes.map(i=>i.rebuilds);for(const [key,view]of views){assert.ok(profileBookInterested(key));(view.bids as Map<number,number>).set(99,90000);emitProfileBook({key,type:'patch',patches:[{side:'bid',price:99,old:key.startsWith('usdm')?70000:20000,qty:90000}]});}
 const demand={id:'same',asset:'BTC' as const,revision:1,low:98,high:103,height:600};for(let i=0;i<40;i++){manager.setDemands([{...demand,mode:i%2?'all4':'coinbase',market:'spot'},{...demand,id:'future',mode:'binance',market:'usdm'}]);manager.pulse();manager.setDemands([]);}
 assert.deepEqual(manager.diagnostics().indexes.map(i=>i.rebuilds),rebuilds);assert.equal(frames.filter(f=>f.market==='usdm').at(-1).levels.reduce((n:number,b:any)=>n+b.bid,0),99*90000);
 const book=views.get('usdm:binance:BTC')!;book.generation=2;book.bids=new Map([[99,200000]]);emitProfileBook({key:'usdm:binance:BTC',type:'reset'});manager.setDemands([{...demand,mode:'binance',market:'usdm'}]);manager.pulse();assert.equal(frames.at(-1).sources[0].available,false,'old index cannot borrow new generation quality');await until(()=>manager.diagnostics().indexes.find(i=>i.key==='usdm:binance:BTC')!.ready);manager.pulse();assert.equal(frames.at(-1).levels.reduce((n:number,b:any)=>n+b.bid,0),19800000);manager.stop();
});
test('USDM REST validates perpetual tick metadata, deduplicates snapshots and respects 429 cooldown without Sites',async()=>{
 let snapshots=0;const rest=new UsdmRest(async input=>{const url=String(input);if(url.includes('exchangeInfo'))return Response.json({rateLimits:[{rateLimitType:'REQUEST_WEIGHT',interval:'MINUTE',intervalNum:1,limit:2400}],symbols:[{symbol:'BTCUSDT',status:'TRADING',contractType:'PERPETUAL',quoteAsset:'USDT',filters:[{filterType:'PRICE_FILTER',tickSize:'.1'}]},{symbol:'ETHUSDT',status:'TRADING',contractType:'CURRENT_QUARTER',quoteAsset:'USDT'}]});snapshots++;return Response.json(snapshot());});
 const signal=new AbortController().signal;assert.equal((await rest.markets(signal)).get('BTCUSDT')?.tick,.1);assert.equal((await rest.markets(signal)).has('ETHUSDT'),false);const a=rest.snapshot('BTCUSDT',signal),b=rest.snapshot('BTCUSDT',signal);assert.equal(a,b);await a;assert.equal(snapshots,1);
 const blocked=new UsdmRest(async()=>new Response('',{status:429,headers:{'Retry-After':'120'}}));await assert.rejects(blocked.markets(signal),e=>e instanceof UsdmHttpError&&e.status===429);assert.ok(blocked.blockedUntil>Date.now()+119000);
});
test('collector isolates an asset gap, rejects late socket/snapshot and keeps healthy book on refresh overflow',async()=>{
 const oldSocket=globalThis.WebSocket;const sockets:Socket[]=[];let loads=0,late:((v:any)=>void)|undefined;
 class Socket{static OPEN=1;static CLOSED=3;readyState=0;onopen:any;onmessage:any;onclose:any;onerror:any;url:string;constructor(url:string){this.url=url;sockets.push(this);}open(){this.readyState=1;this.onopen?.();}emit(asset:string,e=diff()){this.onmessage?.({data:JSON.stringify({data:{...e,s:asset+'USDT'}})});}send(_data:string){}close(){this.readyState=3;this.onclose?.();}}
 Object.defineProperty(globalThis,'WebSocket',{value:Socket,writable:true,configurable:true});
 const rest={blockedUntil:0,markets:async()=>new Map(ASSETS.map(a=>[a+'USDT',{symbol:a+'USDT',tick:1,contractType:'PERPETUAL',quote:'USDT'}])),snapshot:async()=>{loads++;if(loads>3)return new Promise(resolve=>{late=resolve;});return snapshot();}} as unknown as UsdmRest;
 const statuses:any[]=[],collector=new UsdmCollector({socket:url=>new Socket(url) as any,rest,report:s=>statuses.push(s)});
 try{collector.start();assert.match(sockets[0].url,/\/public\/stream/);sockets[0].open();await sleep();for(const asset of ASSETS)sockets[0].emit(asset);assert.ok(collector.diagnostics().every(s=>s.ready));const generations=collector.diagnostics().map(s=>s.generation);const btc=readProfileBook('usdm:binance:BTC')!;
  (collector as any).sync((collector as any).states.get('BTC'),true);await sleep();for(let i=0;i<4097;i++)sockets[0].emit('BTC');assert.equal(readProfileBook('usdm:binance:BTC')!.ready,true);assert.equal(readProfileBook('usdm:binance:BTC')!.bids,btc.bids);late?.(snapshot());await sleep();assert.deepEqual(collector.diagnostics().map(s=>s.generation),generations);
  sockets[0].emit('ETH',diff(102,103,77));assert.equal(collector.diagnostics().find(s=>s.asset==='ETH')!.ready,false);assert.equal(collector.diagnostics().find(s=>s.asset==='BTC')!.ready,true);assert.equal(collector.diagnostics().find(s=>s.asset==='SOL')!.ready,true);assert.equal(sockets.length,1);
  const oldCallback=sockets[0].onmessage;sockets[0].close();oldCallback({data:JSON.stringify({data:diff()})});late?.(snapshot());await sleep();assert.ok(collector.diagnostics().every(s=>!s.ready));assert.ok(statuses.some(s=>s.market==='usdm'));
 }finally{collector.stop();Object.defineProperty(globalThis,'WebSocket',{value:oldSocket,writable:true,configurable:true});}
});
test('quiet transport probes once, control reply leaves book time unchanged, and 24-hour socket replacement has a new book generation',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout','setInterval']});const oldSocket=globalThis.WebSocket,sockets:Socket[]=[];let now=100000,loads=0;
 class Socket{static OPEN=1;static CLOSED=3;readyState=0;onopen:any;onmessage:any;onclose:any;onerror:any;sent:any[]=[];constructor(_url:string){sockets.push(this);}open(){this.readyState=1;this.onopen?.();}message(data:any){this.onmessage?.({data:JSON.stringify(data)});}send(data:string){this.sent.push(JSON.parse(data));}close(){this.readyState=3;this.onclose?.();}}
 Object.defineProperty(globalThis,'WebSocket',{value:Socket,writable:true,configurable:true});
 const rest={blockedUntil:0,markets:async()=>new Map(ASSETS.map(a=>[a+'USDT',{symbol:a+'USDT',tick:1,contractType:'PERPETUAL',quote:'USDT'}])),snapshot:async()=>snapshot(++loads<=3?100:200)} as unknown as UsdmRest;
 const drain=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};const collector=new UsdmCollector({socket:url=>new Socket(url) as any,rest,now:()=>now});
 try{collector.start();sockets[0].open();await drain();for(const asset of ASSETS)sockets[0].message({data:{...diff(),s:asset+'USDT'}});assert.ok(collector.diagnostics().every(s=>s.ready));
  now+=45000;(collector as any).maintenance();(collector as any).maintenance();assert.equal(sockets[0].sent.length,1);assert.equal(sockets[0].sent[0].method,'LIST_SUBSCRIPTIONS');const updated=readProfileBook('usdm:binance:BTC')!.updateAt;
  sockets[0].message({id:sockets[0].sent[0].id,result:ASSETS.map(a=>a.toLowerCase()+'usdt@depth@100ms')});assert.equal(readProfileBook('usdm:binance:BTC')!.updateAt,updated);assert.ok(collector.diagnostics().every(s=>s.ready));
  now+=24*3600000;sockets[0].close();t.mock.timers.tick(5000);assert.equal(sockets.length,2);sockets[1].open();await drain();for(const asset of ASSETS)sockets[1].message({data:{...diff(200,201,199),s:asset+'USDT'}});assert.ok(collector.diagnostics().every(s=>s.ready&&s.generation===2&&s.id===201));
  sockets[0].message({data:diff(202,999,201)});assert.ok(collector.diagnostics().every(s=>s.id===201));
  now+=45000;(collector as any).maintenance();t.mock.timers.tick(10000);assert.equal(sockets[1].readyState,3,'unanswered probe reconnects after ten seconds');
 }finally{collector.stop();Object.defineProperty(globalThis,'WebSocket',{value:oldSocket,writable:true,configurable:true});t.mock.timers.reset();}
});
test('Sites API scopes usdm to Binance core symbols and keeps normalized sequence/tick; repeated callers share a snapshot',async()=>{
 const original=globalThis.fetch;let calls=0;globalThis.fetch=async input=>{if(String(input).includes('exchangeInfo'))return Response.json({symbols:ASSETS.map(a=>({symbol:a+'USDT',status:'TRADING',contractType:'PERPETUAL',quoteAsset:'USDT',filters:[{filterType:'PRICE_FILTER',tickSize:'.01'}]}))});calls++;return Response.json(snapshot());};
 try{const {monitorApi}=await import('../worker/monitor');for(const query of ['market=usdm&exchange=Coinbase&symbol=BTC','market=usdm&exchange=Binance&symbol=DOGE','market=invalid&exchange=Binance&symbol=BTC'])assert.equal((await monitorApi(new Request('https://test/api/order-book?'+query)))?.status,400);
  const url='https://test/api/order-book?market=usdm&exchange=Binance&symbol=BTC';const results=await Promise.all([monitorApi(new Request(url)),monitorApi(new Request(url))]);assert.equal(calls,1);for(const result of results){assert.equal(result?.status,200);const body:any=await result!.json();assert.equal(body.market,'usdm');assert.equal(body.book.lastUpdateId,100);assert.equal(body.book.tickSize,.01);assert.deepEqual(body.book.bids[0],[99,2]);}
 }finally{globalThis.fetch=original;}
});
