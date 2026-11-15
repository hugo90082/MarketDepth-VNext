import {withAbortDeadline} from '../src/monitor/request-deadline';
const PATH='/api/coinbase-stream',UPSTREAM='https://ws-feed.exchange.coinbase.com';
const active=new Map<string,number>();let total=0;
type Socket=WebSocket;
export function relayCommand(raw:unknown){
 if(typeof raw!=='string'||raw.length>16384)throw Error('BAD_COMMAND');
 const value=JSON.parse(raw);
 if(!value||!['subscribe','unsubscribe'].includes(value.type)||Object.keys(value).some(k=>!['type','product_ids','channels'].includes(k)))throw Error('BAD_COMMAND');
 if(!Array.isArray(value.product_ids)||!value.product_ids.length||value.product_ids.length>50||value.product_ids.some((p:unknown)=>typeof p!=='string'||!/^([A-Z0-9]{2,15})-USD$/.test(p)))throw Error('BAD_PRODUCTS');
 if(!Array.isArray(value.channels)||!value.channels.length||value.channels.length>2||value.channels.some((c:unknown)=>!['level2_batch','heartbeat'].includes(c as string)))throw Error('BAD_CHANNELS');
 return {type:value.type as 'subscribe'|'unsubscribe',product_ids:[...new Set<string>(value.product_ids)],channels:[...new Set<string>(value.channels)]};
}
/** Forward public market frames without parsing/copying entire order books. */
export function bridgeCoinbase(down:Socket,up:Socket,release:()=>void,clock=Date.now){
 let ended=false,activity=clock(),controlAt=clock(),controls=0;const subscribed=new Set<string>();
 const finish=(code=1000,reason='串流已關閉')=>{if(ended)return;ended=true;clearInterval(watch);for(const socket of [down,up])try{socket.close(code,reason.slice(0,100));}catch{}release();};
 const watch=setInterval(()=>{if(clock()-activity>60000)finish(1001,'來源逾時');},15000);
 down.addEventListener('message',event=>{if(ended)return;try{if(clock()-controlAt>=10000){controlAt=clock();controls=0;}if(++controls>30)throw Error('TOO_MANY_COMMANDS');const command=relayCommand(event.data),next=new Set(subscribed);for(const p of command.product_ids)command.type==='subscribe'?next.add(p):next.delete(p);if(next.size>50)throw Error('TOO_MANY_PRODUCTS');up.send(JSON.stringify(command));subscribed.clear();for(const p of next)subscribed.add(p);}catch{finish(1008,'僅支援公開現貨深度訂閱');}});
 up.addEventListener('message',event=>{if(ended)return;activity=clock();if(typeof event.data!=='string'||event.data.length>16_000_000){finish(1009,'來源訊息過大或格式不符');return;}try{down.send(event.data);}catch{finish(1011,'中繼傳送失敗');}});
 for(const socket of [down,up]){socket.addEventListener('close',()=>finish());socket.addEventListener('error',()=>finish(1011,'來源連線中斷'));}
 return finish;
}
type Options={fetcher?:typeof fetch;pair?:()=>{0:Socket;1:Socket};upgrade?:(socket:Socket)=>Response};
export async function coinbaseRelay(request:Request,options:Options={}):Promise<Response|null>{
 const url=new URL(request.url);if(url.pathname!==PATH)return null;
 const error=(code:string,status:number)=>Response.json({ok:false,error:{code}},{status,headers:{'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow'}});
 if(request.method!=='GET'||url.search)return error('BAD_RELAY_REQUEST',400);
 if(request.headers.get('Upgrade')?.toLowerCase()!=='websocket')return error('WEBSOCKET_REQUIRED',426);
 if(request.headers.get('Origin')!==url.origin)return error('ORIGIN_NOT_ALLOWED',403);
 const ip=request.headers.get('CF-Connecting-IP')??'local';if((active.get(ip)??0)>=4||total>=32)return error('RELAY_BUSY',429);
 active.set(ip,(active.get(ip)??0)+1);total++;let released=false;const release=()=>{if(released)return;released=true;total--;const n=(active.get(ip)??1)-1;if(n)active.set(ip,n);else active.delete(ip);};
 let upstream:Socket|undefined;
 try{
  const response=await withAbortDeadline(signal=>(options.fetcher??fetch)(UPSTREAM,{headers:{Upgrade:'websocket'},signal}),8000,'Coinbase 中繼連線逾時');
  if(response.status!==101||!response.webSocket){release();return error('UPSTREAM_UNAVAILABLE',502);}upstream=response.webSocket;
  const pair=(options.pair??(()=>new WebSocketPair()))(),client=pair[0],server=pair[1];upstream.accept();server.accept();
  const close=bridgeCoinbase(server,upstream,release);request.signal.addEventListener('abort',()=>close(1001,'使用者連線已中斷'),{once:true});
  try{return options.upgrade?options.upgrade(client):new Response(null,{status:101,webSocket:client});}catch(e){close(1011,'中繼建立失敗');throw e;}
 }catch{try{upstream?.close();}catch{}release();return error('UPSTREAM_UNAVAILABLE',502);}
}
