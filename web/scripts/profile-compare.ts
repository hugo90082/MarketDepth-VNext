import {execFileSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {ProfileManager} from '../src/runtime/profiles';
import {ASSETS} from '../shared/model';
import {bookKey,registerProfileBook,emitProfileBook,profileBookInterested,type ProfileBookView} from '../shared/profile-books';
const base='18cea5f829e127033b4681c028b752ebcd132cf0';
const text=execFileSync('git',['-c','safe.directory='+process.cwd().replaceAll('\\','/'),'show',base+':src/runtime/profiles.ts'],{encoding:'utf8'}).replaceAll('../../shared/','../shared/').replace("'./profile-index'","'../src/runtime/profile-index'").replace("'../monitor/depth-engine/order-book'","'../src/monitor/depth-engine/order-book'");
await mkdir('.cache',{recursive:true});await writeFile('.cache/v35-profiles.ts',text);
const Old=(await import(pathToFileURL(path.resolve('.cache/v35-profiles.ts')).href)).ProfileManager;
async function run(label:string,Manager:typeof ProfileManager,usdm:boolean){
 const books=new Map<string,ProfileBookView>();for(const asset of ASSETS)for(const [source,market]of [['binance','spot'],['coinbase','spot'],['binance','usdm']] as const){const key=bookKey(source,asset,market),book={bids:new Map(Array.from({length:5000},(_,i)=>[83000-i*.1,1])),asks:new Map(Array.from({length:5000},(_,i)=>[83000.1+i*.1,1])),ready:true,tick:.1,generation:1,complete:true,activityAt:Date.now(),updateAt:Date.now(),snapshotAt:Date.now()};books.set(key,book);registerProfileBook(key,()=>book);}
 let messages=0,bytes=0;const manager=new Manager(frame=>{messages++;bytes+=JSON.stringify(frame).length;});const demand={id:'spot',asset:'BTC' as const,mode:'all4' as const,revision:1,low:82500,high:83500,height:600};manager.setDemands(usdm?[demand,{...demand,id:'usdm',market:'usdm',mode:'binance'}]:[demand]);
 for(let i=0;i<100&&manager.diagnostics().indexes.some(x=>x.building);i++)await new Promise(r=>setTimeout(r,30));
 const cpu=process.cpuUsage(),start=performance.now(),costs:number[]=[],heaps:number[]=[];let patches=0;
 for(let second=0;second<1800;second++){
  for(const [key,book]of books){if(!usdm&&key.startsWith('usdm:'))continue;for(let batch=0;batch<10;batch++){const changes=[];for(let n=0;n<4;n++){const price=83000-((second*7+batch*13+n)%5000)*.1,map=book.bids as Map<number,number>,old=map.get(price)??0,qty=1+(second+batch)%3;map.set(price,qty);if(profileBookInterested(key))changes.push({side:'bid' as const,price,old,qty});}patches+=changes.length;if(changes.length)emitProfileBook({key,type:'patch',patches:changes});}}
  const t=performance.now();manager.pulse();costs.push(performance.now()-t);if(second%100===0){global.gc?.();heaps.push(process.memoryUsage().heapUsed/1024**2);}
  if(!usdm&&second%30===0){for(const source of ['Binance','Coinbase']){const b=books.get(bookKey(source.toLowerCase() as 'binance'|'coinbase','BTC'))!;manager.rebase(source,'BTC',{bids:[...b.bids].sort((a,b)=>b[0]-a[0]),asks:[...b.asks].sort((a,b)=>a[0]-b[0]),capturedAt:Date.now(),lastMessageAt:b.activityAt,acquisitionMode:'web-feed'} as any);}await new Promise(r=>setTimeout(r,30));}
 }
 costs.sort((a,b)=>a-b);const usage=process.cpuUsage(cpu),result={label,simulatedSeconds:1800,levelsPerBook:10000,maintainedIndexes:manager.diagnostics().indexes.length,cpuMs:(usage.user+usage.system)/1000,wallMs:performance.now()-start,queryP95:costs[Math.floor(costs.length*.95)],messages,summaryBytes:bytes,patches,heapSamplesMB:heaps};manager.stop();return result;
}
const results=[await run('v35',Old,false),await run('spot-usdm',ProfileManager,true)];await writeFile('work/profile-compare.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
