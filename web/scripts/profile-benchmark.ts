import {ProfileIndex} from '../src/runtime/profile-index';
import {CoinbaseLiveBook} from '../shared/live-books';
import type {ProfileBookView} from '../shared/profile-books';
import {performance} from 'node:perf_hooks';
const sides=250000;
const book:ProfileBookView={bids:new Map(Array.from({length:sides},(_,i)=>[83000-i*.01,1])),asks:new Map(Array.from({length:sides},(_,i)=>[83000.01+i*.01,1])),ready:true,complete:true,tick:.01,activityAt:Date.now(),updateAt:Date.now(),snapshotAt:Date.now()};
const index=new ProfileIndex(),start=performance.now();await index.rebuild(book);const buildMs=performance.now()-start;
index.patch(Array.from({length:20000},(_,i)=>({side:'bid' as const,price:83000-i*.01,old:1,qty:2})));
const timings:number[]=[],memory:number[]=[];
for(let second=0;second<600;second++){const before=performance.now();for(let view=0;view<4;view++)index.ranges(820000+view*100,160,10,.01);index.midpoint();timings.push(performance.now()-before);if(second%100===0)memory.push(process.memoryUsage().heapUsed);}
timings.sort((a,b)=>a-b);
function updateCost(observing:boolean){const live=new CoinbaseLiveBook(()=>{},()=>observing);live.update({type:'snapshot',bids:[['100','2']],asks:[['101','3']]},0);const started=performance.now();for(let i=0;i<10000;i++)live.update({type:'l2update',changes:[['buy','100',String(1+i%2)],['sell','101',String(1+i%3)]]},i);return performance.now()-started;}
console.log(JSON.stringify({levels:sides*2,buildMs,dirty:index.dirty,rebuilds:index.rebuilds,simulatedSeconds:600,viewsPerSecond:4,queryMeanMs:timings.reduce((a,b)=>a+b,0)/timings.length,queryP95Ms:timings[Math.floor(timings.length*.95)],queryMaxMs:timings.at(-1),heapSamplesMB:memory.map(m=>m/1024**2),coinbase10000BatchesOffMs:updateCost(false),coinbase10000BatchesOnMs:updateCost(true)},null,2));
