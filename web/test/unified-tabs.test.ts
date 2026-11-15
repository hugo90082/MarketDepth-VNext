import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {build} from 'esbuild';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {IDBFactory} from 'fake-indexeddb';
import {webcrypto} from 'node:crypto';
type Export=typeof import('../src/runtime/client');
const pause=()=>new Promise<void>(resolve=>setTimeout(resolve,25));
async function until(test:()=>boolean){for(let i=0;i<80&&!test();i++)await pause();assert.equal(test(),true,'coordinator converges within two seconds');}
test('two routes share one worker, join without restart, relay RPC, hand off once and reject the old owner',async()=>{
 const compiled=await build({absWorkingDir:process.cwd(),entryPoints:[path.resolve('src/runtime/client.ts')],bundle:true,write:false,format:'cjs',platform:'browser',tsconfigRaw:{compilerOptions:{target:'ES2022'}},define:{'import.meta.url':'"file:///test/src/runtime/client.ts"'},logLevel:'silent',plugins:[{name:'workspace-only',setup(b){b.onResolve({filter:/.*/},a=>({path:path.resolve(a.importer?path.dirname(a.importer):process.cwd(),a.path)+(path.extname(a.path)?'':'.ts')}));b.onLoad({filter:/\.ts$/},async a=>({contents:await readFile(a.path,'utf8'),loader:'ts'}));}}]});
 const channels=new Set<any>(),workers:any[]=[];let held=false,live=0,maxLive=0;
 class Channel{
  cb:(e:any)=>void=()=>{};constructor(public name:string){channels.add(this);}
  addEventListener(_name:string,cb:(e:any)=>void){this.cb=cb;}
  postMessage(data:any){for(const c of channels)if(c!==this&&c.name===this.name)queueMicrotask(()=>c.cb({data:structuredClone(data)}));}
  close(){channels.delete(this);}
 }
 const locks={async request(_name:string,_options:unknown,cb:(lock:unknown)=>Promise<void>){if(held){await cb(null);return;}held=true;try{await cb({name:'shared'});}finally{held=false;}}};
 class Worker{
  onmessage:((e:any)=>void)|undefined;onerror:unknown;messages:any[]=[];closed=false;
  constructor(){workers.push(this);live++;maxLive=Math.max(maxLive,live);}
  postMessage(message:any){this.messages.push(message);if(message.type==='rpc')queueMicrotask(()=>this.onmessage?.({data:{type:'rpc-result',requestId:message.requestId,result:{ok:true,result:message.message}}}));}
  terminate(){if(!this.closed){live--;this.closed=true;}}
 }
 const database=new IDBFactory();
 function page(id:string,route:string,visible:boolean){
  const document=new EventTarget() as EventTarget&{hidden:boolean};document.hidden=!visible;
  const window=new EventTarget(),module={exports:{}};
  const context=vm.createContext({module,exports:module.exports,console,crypto:{...webcrypto,randomUUID:()=>id},navigator:{locks},document,window,location:{pathname:route},BroadcastChannel:Channel,Worker,indexedDB:database,localStorage:{getItem:()=>null,removeItem(){}},URL,AbortController,AbortSignal,DOMException,TextEncoder,TextDecoder,Blob,CompressionStream,DecompressionStream,Response,Request,setTimeout,clearTimeout,setInterval,clearInterval,queueMicrotask,structuredClone});
  vm.runInContext(compiled.outputFiles[0].text,context);return {document,...module.exports as Export};
 }
 const research=page('a','/',true),monitor=page('b','/monitor',false);
 try{
  research.marketRuntime.start();await pause();monitor.marketRuntime.start();await pause();
  assert.equal(workers.length,1);assert.equal(research.marketRuntime.isLeader(),true);assert.equal(monitor.marketRuntime.isLeader(),false);
  assert.equal(research.marketRuntime.state().active,true);assert.equal(research.marketRuntime.state().visible,false);
  monitor.marketRuntime.setMonitorSymbols(['BTC','ETH','SOL','DOGE']);
  await pause();assert.deepEqual(Array.from(workers[0].messages.filter((m:any)=>m.type==='monitor-demand').at(-1).symbols),['BTC','ETH','SOL','DOGE']);
  const answer=await monitor.requestMarket({type:'aggregate',symbol:'DOGE'});assert.equal(answer.ok,true);assert.equal(answer.result.symbol,'DOGE');
  assert.equal(workers[0].messages.filter((m:any)=>m.type==='rpc').length,1);
  const frames:any[]=[];research.marketRuntime.events(m=>{if(m.type==='profile-frame')frames.push(m);});
  const profile={revision:1,asset:'BTC' as const,mode:'all4' as const,low:80,high:120,height:600};
  const profileId=research.marketRuntime.profileDemand('profile',profile);await pause();
  assert.equal(workers[0].messages.filter((m:any)=>m.type==='profile-demand').at(-1).demands.length,1);
  assert.equal(monitor.marketRuntime.profileCapability(),true);
  [...channels][0].postMessage({type:'bootstrap',sender:'a',snapshots:[]});await pause();assert.equal(monitor.marketRuntime.profileCapability(),false,'legacy leader requests a reload without another collector');assert.equal(workers.length,1);
  [...channels][1].postMessage({type:'hello',sender:'b'});await pause();assert.equal(monitor.marketRuntime.profileCapability(),true);
  workers[0].onmessage({data:{type:'profile-frame',id:profileId,...profile,sampleAt:1000,levels:[],totals:[],sources:[]}});await pause();assert.equal(frames.length,1);
  const oldCallback=workers[0].onmessage;
  research.document.hidden=true;monitor.document.hidden=false;
  research.document.dispatchEvent(new Event('visibilitychange'));monitor.document.dispatchEvent(new Event('visibilitychange'));await pause();assert.equal(workers.length,1,'foreground changes retain healthy collector');assert.equal(research.marketRuntime.isLeader(),true);
  assert.equal(workers[0].messages.filter((m:any)=>m.type==='profile-demand').at(-1).demands.length,0,'hidden research stops grouping only');
  research.document.dispatchEvent(new Event('freeze'));await until(()=>workers.length===2);monitor.marketRuntime.setRoute('/monitor');await pause();
  assert.equal(workers.length,2);assert.equal(workers[0].closed,true);assert.equal(monitor.marketRuntime.isLeader(),true);assert.equal(live,1);assert.equal(maxLive,1);
  assert.equal(workers[1].messages.filter((m:any)=>m.type==='profile-demand').at(-1).demands.length,0,'hidden research pages do not calculate profiles');
  oldCallback({data:{type:'profile-frame',id:profileId,...profile,sampleAt:2000,levels:[],totals:[],sources:[]}});await pause();assert.equal(frames.length,1,'obsolete owner cannot publish profile data');
  oldCallback({data:{type:'snapshot',symbol:'BTC',payload:{generatedAt:99}}});await pause();assert.equal(research.marketRuntime.snapshot('BTC'),undefined);
  let obsolete=0;monitor.marketRuntime.events(m=>{if(m.obsolete)obsolete++;});
  for(const type of ['prices','coverage','job-state'])[...channels][0].postMessage({type:'research-coordination',sender:'a',owner:'a',epoch:frames[0].epoch,obsolete:true,payload:{type}});
  for(const type of ['row','candle','book-status','profile-frame','snapshot'])[...channels][0].postMessage({type:'data',sender:'a',payload:{type,owner:'a',epoch:frames[0].epoch,obsolete:true,symbol:'BTC',payload:{generatedAt:9999},row:{t:9999},state:{exchange:'Binance',symbol:'BTC',phase:'ready'}}});
  [...channels][0].postMessage({type:'bootstrap',sender:'a',epoch:frames[0].epoch,profileVersion:2,presence:{id:'a',visible:true,monitor:false},snapshots:[['BTC',{generatedAt:9999}]]});await pause();assert.equal(obsolete,0,'all old collector data is fenced');assert.equal(monitor.marketRuntime.snapshot('BTC'),undefined,'obsolete bootstrap cannot replay data');
  workers[1].onmessage({data:{type:'snapshot',symbol:'BTC',payload:{generatedAt:100}}});await pause();
  assert.equal(research.marketRuntime.snapshot('BTC')?.generatedAt,100);
  workers[1].onmessage({data:{type:'snapshot',symbol:'BTC',payload:{generatedAt:50}}});await pause();assert.equal(monitor.marketRuntime.snapshot('BTC')?.generatedAt,100);
  monitor.marketRuntime.setRoute('/');await pause();assert.equal(workers.length,2,'route changes retain the active worker');
  const otherId=monitor.marketRuntime.profileDemand('other-view',{...profile,revision:2,low:90});await pause();assert.equal(workers[1].messages.filter((m:any)=>m.type==='profile-demand').at(-1).demands[0].id,otherId);
  research.document.dispatchEvent(new Event('resume'));await pause();assert.equal(monitor.marketRuntime.isLeader(),true,'resuming old owner does not replace healthy collector');assert.equal(maxLive,1);
  monitor.document.dispatchEvent(new Event('freeze'));await until(()=>research.marketRuntime.isLeader()&&live===1);assert.equal(live,1);assert.equal(monitor.marketRuntime.isLeader(),false);
  monitor.document.dispatchEvent(new Event('resume'));await pause();assert.equal(research.marketRuntime.isLeader(),true);assert.equal(maxLive,1);
  monitor.marketRuntime.stop();research.marketRuntime.setRoute('/');await until(()=>research.marketRuntime.isLeader());assert.equal(maxLive,1);
 }finally{research.marketRuntime.stop();monitor.marketRuntime.stop();}
});
