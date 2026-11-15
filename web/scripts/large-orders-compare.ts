import {execFileSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {ProfileManager} from '../src/runtime/profiles';
import {ASSETS} from '../shared/model';
import {bookKey,registerProfileBook,emitProfileBook,type ProfileBookView} from '../shared/profile-books';
const base='8c228982d7c36b4e863a8e62043e7d5c175af450';
const old=(file:string)=>execFileSync('git',['-c','safe.directory='+process.cwd().replaceAll('\\','/'),'show',base+':'+file],{encoding:'utf8'});
await mkdir('.cache',{recursive:true});
await writeFile('.cache/v36-profile-types.ts',old('shared/order-book-profile.ts').replace("'./model'","'../shared/model'"));
await writeFile('.cache/v36-profile-manager.ts',old('src/runtime/profiles.ts').replaceAll('../../shared/','../shared/').replace("'../shared/order-book-profile'","'./v36-profile-types'").replace("'./profile-index'","'../src/runtime/profile-index'").replace("'../monitor/depth-engine/order-book'","'../src/monitor/depth-engine/order-book'"));
const Old=(await import(pathToFileURL(path.resolve('.cache/v36-profile-manager.ts')).href)).ProfileManager;
async function run(label:string,Manager:typeof ProfileManager){
 const books=new Map<string,ProfileBookView>();let now=Date.now();
 for(const [a,asset]of ASSETS.entries())for(const [source,market]of [['binance','spot'],['coinbase','spot'],['binance','usdm']] as const){const mid=[83000,2500,110][a],tick=[.1,.01,.001][a],threshold=[1e6,5e5,5e4][a];const values=(side:number)=>new Map(Array.from({length:5000},(_,i)=>{const p=Number((mid+side*(i+1)*tick).toFixed(8));return [p,(i%17===0?threshold*1.2:threshold*.01)/p] as const;}));const key=bookKey(source,asset,market),book={bids:values(-1),asks:values(1),ready:true,tick,generation:1,complete:true,activityAt:now,updateAt:now,snapshotAt:now};books.set(key,book);registerProfileBook(key,()=>book);}
 let messages=0,bytes=0;const manager=new Manager(frame=>{messages++;bytes+=JSON.stringify(frame).length;},()=>now);
 manager.setDemands(ASSETS.flatMap((asset,i)=>{const mid=[83000,2500,110][i];return ['spot','usdm'].map(market=>({id:asset+market,asset,market,mode:market==='spot'?'all4':'binance',revision:1,low:mid*.97,high:mid*1.03,height:620}));}) as any);
 for(let i=0;i<200&&manager.diagnostics().indexes.some(x=>!x.ready);i++)await new Promise(r=>setTimeout(r,10));
 const start=performance.now(),cpu=process.cpuUsage(),costs:number[]=[],heaps:number[]=[];
 for(let second=0;second<1800;second++){now+=1000;
  for(const [key,book]of books){book.activityAt=book.updateAt=now;const asset=key.split(':').at(-1)!,a=ASSETS.indexOf(asset as any),mid=[83000,2500,110][a],tick=[.1,.01,.001][a],threshold=[1e6,5e5,5e4][a];for(let batch=0;batch<10;batch++){const patches=[];for(let n=0;n<4;n++){const i=(second*7+batch*13+n)%5000,p=Number((mid-(i+1)*tick).toFixed(8)),map=book.bids as Map<number,number>,old=map.get(p)??0,qty=(i%17===0?threshold*(.5+(second%5)*.3):threshold*.01)/p;map.set(p,qty);patches.push({side:'bid' as const,price:p,old,qty});}emitProfileBook({key,type:'patch',patches});}}
  const at=performance.now();manager.pulse();costs.push(performance.now()-at);if(second%100===0){global.gc?.();heaps.push(process.memoryUsage().heapUsed/1024**2);await new Promise(r=>setTimeout(r,0));}
 }
 costs.sort((a,b)=>a-b);const usage=process.cpuUsage(cpu),result={label,simulatedSeconds:1800,books:9,levelsPerBook:10000,views:6,cpuMs:(usage.user+usage.system)/1000,wallMs:performance.now()-start,p95Ms:costs[Math.floor(costs.length*.95)],messages,summaryBytes:bytes,heapMB:heaps,final:manager.diagnostics()};manager.stop();return result;
}
const results=[await run('v36',Old),await run('large-orders',ProfileManager)];await writeFile('work/large-orders-compare.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results.map(({final,...r})=>r),null,2));
