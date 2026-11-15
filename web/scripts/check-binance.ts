// Explicit, bounded read-only verification: two snapshots per asset, 20s of WS.
import {BinanceBookSession} from '../shared/binance-book';
import {binanceDepthStream,endpoint} from '../shared/exchanges';
const results:Record<string,any>={},sockets:WebSocket[]=[];
let blocked=false;
for(const asset of (process.argv.includes('--btc-only')?['BTC']:['BTC','ETH']) as ('BTC'|'ETH')[]){
 const session=new BinanceBookSession(),outsideBids=new Set<number>(),outsideAsks=new Set<number>();
 const result=results[asset]={requests:0,messages:0,errors:[],snapshots:[]};
 const ws=new WebSocket(binanceDepthStream(asset));sockets.push(ws);
 async function snapshot(forceRefresh=false){
  // Pass a simulated 15-minute age only to exercise a real REST rebootstrap
  // while the same WebSocket remains open; install timestamps stay real.
  if(blocked||ws.readyState!==WebSocket.OPEN||!session.begin(forceRefresh?Date.now()+15*60_000:undefined))return;
  try{result.requests++;const r=await fetch(endpoint('binance-book',asset),{signal:AbortSignal.timeout(8000)});
   if(!r.ok){blocked=[418,429].includes(r.status);throw new Error(`HTTP_${r.status}`);}
   const raw=await r.json();
   const bidEdge=Math.min(...raw.bids.map((level:string[])=>Number(level[0])));
   const askEdge=Math.max(...raw.asks.map((level:string[])=>Number(level[0])));
   const outer=forceRefresh?{
    bids:[...session.book.bids].filter(([price])=>price<bidEdge),
    asks:[...session.book.asks].filter(([price])=>price>askEdge),
   }:null;
   session.install(raw,Date.now());
   if(outer){
    const bids=outer.bids.filter(([price,qty])=>session.book.bids.get(price)===qty).length;
    const asks=outer.asks.filter(([price,qty])=>session.book.asks.get(price)===qty).length;
    result.refreshRetention={expectedBids:outer.bids.length,matchedBids:bids,expectedAsks:outer.asks.length,matchedAsks:asks};
    if(bids!==outer.bids.length||asks!==outer.asks.length)result.errors.push('OUTER_LEVEL_LOST_ON_REFRESH');
   }
   result.snapshots.push({at:Date.now(),id:session.book.id,bids:session.book.bids.size,asks:session.book.asks.size,weight:r.headers.get('x-mbx-used-weight-1m')});
  }catch(e){session.cancel();result.errors.push((e as Error).message);}
 }
 ws.onopen=()=>{void snapshot();setTimeout(()=>{result.beforeRefresh=session.coverage();void snapshot(true);},10000);};
 ws.onmessage=e=>{try{const data=JSON.parse(String(e.data));result.messages++;if(session.synchronized){for(const [price] of data.b??[])if(Number(price)<session.book.edges[0])outsideBids.add(Number(price));for(const [price] of data.a??[])if(Number(price)>session.book.edges[1])outsideAsks.add(Number(price));}session.receive(data,Date.now());}catch(e){result.errors.push((e as Error).message);ws.close();}};
 ws.onerror=()=>result.errors.push('WS_ERROR');
 setTimeout(()=>{result.afterRefresh=session.coverage();result.outerChangedPrices={bids:outsideBids.size,asks:outsideAsks.size};result.zones=session.book.snapshot(Date.now()).map(p=>p.map(v=>v!==null));result.synchronized=session.synchronized;result.levels={bids:session.book.bids.size,asks:session.book.asks.size};result.heapMiB=Math.round(process.memoryUsage().heapUsed/1048576);},19000);
}
setTimeout(()=>{for(const ws of sockets)ws.close();console.log(JSON.stringify(results,null,2));setTimeout(()=>process.exit(Object.values(results).some(x=>x.errors.length||!x.synchronized)?1:0),250);},20000);
