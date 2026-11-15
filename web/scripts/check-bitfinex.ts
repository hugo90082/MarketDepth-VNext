// Bounded public-market QA for the fixed P1/P2 acquisition policy.
import {BitfinexLiveBooks} from '../shared/live-books';
import {endpoint,parseBook} from '../shared/exchanges';

const result:{rest:Record<string,unknown>;ws:Record<string,unknown>;errors:string[]}={rest:{},ws:{},errors:[]};
for(const kind of ['bitfinex-near','bitfinex-broad'] as const){
 try{
  const response=await fetch(endpoint(kind,'BTC'),{signal:AbortSignal.timeout(8000)});
  if(!response.ok)throw new Error(`HTTP_${response.status}`);
  const book=parseBook(kind,await response.json());
  result.rest[kind]={bids:book.bids.length,asks:book.asks.length};
 }catch(error){result.errors.push(`${kind}:${(error as Error).message}`);}
}

const books=new BitfinexLiveBooks();
const ws=new WebSocket('wss://api-pub.bitfinex.com/ws/2');
ws.onopen=()=>{
 ws.send(JSON.stringify({event:'conf',flags:131072}));
 for(const prec of ['P1','P2'])ws.send(JSON.stringify({event:'subscribe',channel:'book',symbol:'tBTCUSD',prec,freq:'F1',len:'250'}));
};
ws.onmessage=event=>{
 try{
  const data=JSON.parse(String(event.data));
  if(data.event==='error')throw new Error(`WS_${data.code??'ERROR'}`);
  if(data.event==='subscribed'&&data.channel==='book'&&(data.prec==='P1'||data.prec==='P2')){
   books.subscribe(data.chanId,'BTC',data.prec);
   result.ws[data.prec]='subscribed';
  }else if(Array.isArray(data)){
   books.update(data,Date.now());
   const current=books.snapshot('BTC',Date.now());
   if(current.nearReady)result.ws.P1='ready';
   if(current.broadReady)result.ws.P2='ready';
  }
 }catch(error){result.errors.push((error as Error).message);ws.close();}
};
ws.onerror=()=>result.errors.push('WS_ERROR');
await new Promise<void>(resolve=>setTimeout(resolve,10000));
ws.close();
const current=books.snapshot('BTC',Date.now());
result.ws.zones=current.zones.map(pair=>pair.map(value=>value!==null));
console.log(JSON.stringify(result,null,2));
if(result.errors.length||!current.nearReady||!current.broadReady)process.exitCode=1;
