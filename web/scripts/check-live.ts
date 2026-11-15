// Read-only public feed probe; no credentials, persistence, or order endpoints.
import {ASSETS,type Asset} from '../shared/model';
import {KrakenLiveBook,BitfinexLiveBooks,CoinbaseLiveBook,parseKrakenMessage} from '../shared/live-books';
import {binanceDepthStream,SequencedBook} from '../shared/exchanges';
const duration=20000;
const report:Record<string,any>={};
const sockets:WebSocket[]=[];
function feed(name:string,url:string,subscribe:(ws:WebSocket)=>void,handle:(data:any)=>void,parse=(s:string)=>JSON.parse(s)){
 const state=report[name]={opened:false,messages:0,bytes:0,errors:[] as string[]};const ws=new WebSocket(url);sockets.push(ws);
 ws.onopen=()=>{state.opened=true;subscribe(ws);};ws.onmessage=e=>{state.messages++;state.bytes+=String(e.data).length;try{handle(parse(String(e.data)));}catch(e){state.errors.push((e as Error).message);ws.close();}};
 ws.onerror=()=>state.errors.push('socket error');ws.onclose=e=>{state.closeCode=e.code;};
 return ws;
}
const kraken=new Map(ASSETS.map(a=>[a,new KrakenLiveBook()])),coinbase=new Map(ASSETS.map(a=>[a,new CoinbaseLiveBook()])),bitfinex=new BitfinexLiveBooks(),binance=new SequencedBook();
feed('kraken','wss://ws.kraken.com/v2',ws=>ws.send(JSON.stringify({method:'subscribe',params:{channel:'book',symbol:ASSETS.map(a=>a+'/USD'),depth:1000,snapshot:true}})),x=>{if(x.channel==='book')for(const b of x.data??[])kraken.get(b.symbol.split('/')[0])?.update(b,x.type,Date.now());},parseKrakenMessage);
feed('coinbase','wss://ws-feed.exchange.coinbase.com',ws=>ws.send(JSON.stringify({type:'subscribe',product_ids:ASSETS.map(a=>a+'-USD'),channels:['level2_batch','heartbeat']})),x=>{if(x.type==='error')throw new Error(x.message);const b=coinbase.get(x.product_id?.split('-')[0]);if(b&&(x.type==='snapshot'||x.type==='l2update'))b.update(x,Date.now());});
feed('bitfinex','wss://api-pub.bitfinex.com/ws/2',ws=>{ws.send(JSON.stringify({event:'conf',flags:131072}));for(const a of ASSETS)for(const prec of ['P0','P2'])ws.send(JSON.stringify({event:'subscribe',channel:'book',symbol:'t'+a+'USD',prec,freq:'F1',len:'250'}));},x=>{if(Array.isArray(x))bitfinex.update(x,Date.now());else if(x.event==='subscribed')bitfinex.subscribe(x.chanId,x.symbol.slice(1,-3) as Asset,x.prec);else if(x.event==='error')throw new Error(x.msg);});
const queue:any[]=[];
feed('binance',binanceDepthStream('BTC'),ws=>{void fetch('https://data-api.binance.vision/api/v3/depth?symbol=BTCUSDT&limit=5000').then(async r=>{report.binance.restStatus=r.status;if(!r.ok)return;binance.replace(await r.json(),Date.now());for(const x of queue.splice(0))binance.diff(x,Date.now());}).catch(e=>report.binance.errors.push(e.message));},x=>{if(binance.ready)binance.diff(x,Date.now());else if(queue.length<300)queue.push(x);});
setTimeout(()=>{for(const ws of sockets)ws.close();for(const [name,state]of Object.entries(report)){state.kibPerSecond=+(state.bytes/1024/(duration/1000)).toFixed(1);delete state.bytes;}console.log(JSON.stringify({report,ready:{binance:binance.ready,kraken:[...kraken].map(([a,b])=>[a,b.ready]),coinbase:[...coinbase].map(([a,b])=>[a,b.ready]),bitfinex:ASSETS.map(a=>[a,bitfinex.snapshot(a,Date.now()).nearReady,bitfinex.snapshot(a,Date.now()).broadReady])}},null,2));setTimeout(()=>process.exit(0),500);},duration);

