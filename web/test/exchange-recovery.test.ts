import {test} from 'node:test';import assert from 'node:assert/strict';
import {classifyKrakenBookResponse} from '../src/monitor/exchange-errors';
const flush=async()=>{for(let i=0;i<20;i++)await new Promise<void>(r=>setImmediate(r));};
test('a temporary Kraken API error cannot disable an existing pair for six hours',async context=>{
 const original=globalThis.fetch;context.mock.timers.enable({apis:['Date','setTimeout'],now:1790937000000});let attempts=0;
 globalThis.fetch=async input=>{const url=String(input);if(url.includes('market-selections'))return Response.json({symbol:'ETH',selections:{Kraken:{market:{pair:'ETHUSD',quote:'USD',tickSize:.01}}}});if(url.includes('GroupedBook'))return ++attempts===1?Response.json({error:['EService:Unavailable']}):Response.json({error:[],result:{bids:[{price:99,qty:2},{price:90,qty:3}],asks:[{price:101,qty:2},{price:110,qty:3}]}});if(url.startsWith('/api/order-book'))return new Response('',{status:503});throw Error(url);};
 const books=await import('../src/runtime/books');
 async function complete<T>(p:Promise<T>){let done=false,value:T|undefined,error:unknown;void p.then(v=>{done=true;value=v;},e=>{done=true;error=e;});for(let i=0;i<100&&!done;i++){await flush();if(!done)context.mock.timers.tick(250);}if(error)throw error;if(!done)throw Error('request did not settle');return value!;}
 try{const first=await complete(books.acquire('Kraken','ETH'));assert.equal(first.source.status,'error','temporary upstream error must stay retryable, not unsupported');const next=await complete(books.acquire('Kraken','ETH'));assert.ok(['ok','partial'].includes(next.source.status));assert.equal(attempts,2);}finally{books.stopBooks();globalThis.fetch=original;context.mock.timers.reset();}
});

test('Kraken only rejects an explicitly unknown pair; service, grouping and empty responses remain retryable',()=>{
 for(const error of [['EService:Unavailable'],['EGeneral:Invalid arguments:grouping'],['EQuery:Unknown asset pair','EService:Throttled']])assert.notEqual(classifyKrakenBookResponse({error}),'unsupported');
 assert.equal(classifyKrakenBookResponse({error:['EAPI:Rate limit exceeded']}),'rate_limit');assert.equal(classifyKrakenBookResponse({error:['EQuery:Unknown asset pair']}),'unsupported');assert.equal(classifyKrakenBookResponse({error:[],result:{bids:[],asks:[]}}),'upstream');
});

test('a hanging direct source leaves time for the existing fallback and does not poison market support',async context=>{
 const original=globalThis.fetch;context.mock.timers.enable({apis:['Date','setTimeout'],now:1790938000000});let fallback=0,attempts=0;
 globalThis.fetch=async(input,init)=>{const url=String(input);if(url.includes('market-selections'))return Response.json({symbol:'SOL',selections:{Kraken:{market:{pair:'SOLUSD',quote:'USD',tickSize:.01}}}});if(url.includes('GroupedBook')){attempts++;return new Promise((_,reject)=>init!.signal!.addEventListener('abort',()=>reject(new Error('direct timed out')),{once:true}));}if(url.startsWith('/api/order-book')){fallback++;return Response.json({encoding:'normalized-book',exchange:'Kraken',symbol:'SOL',book:{bids:[[99,2],[90,3]],asks:[[101,2],[110,3]],quote:'USD',pair:'SOLUSD',capturedAt:Date.now(),feed:'REST GroupedBook',snapshotCount:1}});}throw Error(url);};
 const books=await import('../src/runtime/books');
 async function complete<T>(p:Promise<T>){let done=false,value:T|undefined,error:unknown;void p.then(v=>{done=true;value=v;},e=>{done=true;error=e;});for(let i=0;i<130&&!done;i++){await flush();if(!done)context.mock.timers.tick(250);}if(error)throw error;if(!done)throw Error('request did not settle');return value!;}
 try{const start=Date.now(),value=await complete(books.acquire('Kraken','SOL'));assert.equal(fallback,1);assert.ok(attempts>0);assert.ok(Date.now()-start<30000);assert.ok(value.book);assert.equal(value.book.acquisitionMode,'cloud-fallback');assert.ok(['ok','partial'].includes(value.source.status));}finally{books.stopBooks();globalThis.fetch=original;context.mock.timers.reset();}
});
