import {test} from 'node:test';import assert from 'node:assert/strict';
import {IndicatorWarmup} from '../src/indicators/warmup';
const t=1740000000000-1740000000000%900000,minute=60000;
const row=(time:number,interval=minute)=>[time,'100','110','90','105','1',time+interval-1,'1',1,'1','1','0'];

test('default fetch is called without the service object as its browser receiver',async()=>{
 const original=globalThis.fetch;globalThis.fetch=async function(this:unknown,input){assert.equal(this,undefined);const u=new URL(String(input));return Response.json([row(Number(u.searchParams.get('startTime')))]);};
 try{const service=new IndicatorWarmup(async()=>[]);assert.equal((await service.get({type:'indicator-history',key:'default',asset:'BTC',interval:60000,from:t,to:t+minute})).length,1);}finally{globalThis.fetch=original;}
});
test('overlapping views share a single bounded, paged futures request stream',async()=>{
 let active=0,max=0;const requests:{from:number;to:number;limit:number}[]=[];
 const service=new IndicatorWarmup(async()=>[],async(input)=>{const url=new URL(String(input)),from=Number(url.searchParams.get('startTime')),to=Number(url.searchParams.get('endTime'))+1,limit=Number(url.searchParams.get('limit'));assert.equal(url.origin,'https://fapi.binance.com');assert.equal(url.searchParams.get('interval'),'1m');active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,5));requests.push({from,to,limit});active--;return Response.json(Array.from({length:(to-from)/minute},(_,i)=>row(from+i*minute)));},Date.now,async()=>{});
 const a={type:'indicator-history' as const,asset:'BTC' as const,interval:60000 as const,from:t,to:t+600*minute};
 const [x,y,z]=await Promise.all([service.get({...a,key:'one'}),service.get({...a,key:'two'}),service.get({...a,key:'three',from:t+300*minute,to:t+800*minute})]);
 assert.equal(x.length,600);assert.equal(y.length,600);assert.equal(z.length,500);assert.equal(max,1);assert.ok(requests.every(r=>r.limit<=499));assert.equal(requests.reduce((n,r)=>n+r.limit,0),800);
 const before=requests.length;await service.get({...a,key:'again'});assert.equal(requests.length,before);
});
test('complete local warmup avoids REST and long intervals use their native bars',async()=>{
 let reads=0;const service=new IndicatorWarmup(async r=>[{t:r.from,c:100,closed:true,complete:true}],async(input)=>{reads++;const u=new URL(String(input));assert.equal(u.searchParams.get('interval'),'12h');return Response.json([row(Number(u.searchParams.get('startTime')),43200000)]);},Date.now,async()=>{});
 const at=Math.floor(t/43200000)*43200000;const local=await service.get({type:'indicator-history',key:'local',asset:'SOL',interval:43200000,from:at,to:at+43200000});assert.equal(local.length,1);assert.equal(reads,0);
 const mixed=await service.get({type:'indicator-history',key:'mixed',asset:'ETH',interval:43200000,from:at,to:at+2*43200000});assert.equal(mixed.length,2);assert.equal(reads,1);
});
test('429 cools the shared queue; empty and sparse history remain unknown without retry loops',async()=>{
 let now=t+86400000,calls=0;const sleeps:number[]=[];
 const service=new IndicatorWarmup(async()=>[],async()=>{calls++;return calls===1?new Response(null,{status:429,headers:{'retry-after':'3'}}):Response.json([]);},()=>now,async ms=>{sleeps.push(ms);now+=ms;});
 const r={type:'indicator-history' as const,key:'a',asset:'BTC' as const,interval:60000 as const,from:t,to:t+minute};await assert.rejects(service.get(r),/429/);assert.deepEqual(await service.get({...r,key:'b'}),[]);assert.ok(sleeps.some(n=>n>=3000));await service.get({...r,key:'c'});assert.equal(calls,2);
 const sparse=new IndicatorWarmup(async()=>[],async input=>{const u=new URL(String(input)),from=Number(u.searchParams.get('startTime')),to=Number(u.searchParams.get('endTime'))+1;return Response.json(Array.from({length:(to-from)/minute},(_,i)=>row(from+i*minute)).filter((_,i)=>i%2===0));},Date.now,async()=>{});
 assert.equal((await sparse.get({...r,key:'sparse',to:t+1000*minute})).length,501);
});
test('cancelling one reader does not cancel another reader of the same range; stopped work cannot continue',async()=>{
 const service=new IndicatorWarmup(async()=>[],async input=>{const u=new URL(String(input));return Response.json([row(Number(u.searchParams.get('startTime')))]);},Date.now,async()=>{});
 const r={type:'indicator-history' as const,key:'one',asset:'BTC' as const,interval:60000 as const,from:t,to:t+minute};const a=service.get(r),b=service.get({...r,key:'two'});service.cancel('one');assert.equal((await b).length,1);assert.equal((await a).length,1);
 service.stop();await assert.rejects(service.get({...r,key:'stopped',from:t+minute,to:t+2*minute}),/aborted/);
});

test('local-only reads also respect the memory cache ceiling',async()=>{
 let local=true,requests=0;const service=new IndicatorWarmup(async r=>local?Array.from({length:(r.to-r.from)/minute},(_,i)=>({t:r.from+i*minute,c:100,closed:true})):[],async input=>{requests++;const u=new URL(String(input));return Response.json([row(Number(u.searchParams.get('startTime')))]);},Date.now,async()=>{});
 const r={type:'indicator-history' as const,key:'first',asset:'BTC' as const,interval:60000 as const,from:t,to:t+15000*minute};await service.get(r);await service.get({...r,key:'second',from:r.to,to:r.to+15000*minute});local=false;
 await service.get({...r,key:'evicted',to:t+minute});assert.equal(requests,1,'old locally cached bars must be evicted after 24,000 entries');
});
