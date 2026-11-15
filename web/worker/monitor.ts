import {getMarketDirectory} from '../src/monitor/market-catalog';
import {GET as selections} from '../src/monitor/api/market-selections/route';
import {GET as marketMeta} from '../src/monitor/market-meta-server';
import {bookForSource,EXCHANGES,type Exchange} from '../src/monitor/depth-engine/source-runtime';
import {UsdmRest,UsdmHttpError} from '../shared/usdm-rest';
const usdm=new UsdmRest();
const pending=new Map<string,Promise<Response>>();
export async function monitorApi(request:Request):Promise<Response|null>{
 const url=new URL(request.url);
 if(!['/api/markets','/api/market-selections','/api/market-meta','/api/order-book'].includes(url.pathname))return null;
 if(request.method!=='GET')return Response.json({error:'METHOD_OR_PATH_NOT_ALLOWED'},{status:405});
 if(url.pathname==='/api/markets')return Response.json(await getMarketDirectory(),{headers:{'Cache-Control':'public, max-age=60','X-Robots-Tag':'noindex, nofollow'}});
 if(url.pathname==='/api/market-selections')return selections(request);
 if(url.pathname==='/api/market-meta')return marketMeta(request);
 const symbol=(url.searchParams.get('symbol')??'').toUpperCase(),exchange=url.searchParams.get('exchange') as Exchange;
 if(!/^[A-Z0-9]{2,15}$/.test(symbol)||!EXCHANGES.includes(exchange))return Response.json({error:'BAD_QUERY'},{status:400});
 const market=url.searchParams.get('market')??'spot';
 if(!['spot','usdm'].includes(market)||market==='usdm'&&(exchange!=='Binance'||!['BTC','ETH','SOL'].includes(symbol)))return Response.json({error:'BAD_MARKET'},{status:400});
 const key=market+':'+exchange+':'+symbol;
 let task=pending.get(key);
 if(!task){const signal=AbortSignal.timeout(30000);const book=market==='spot'?bookForSource(exchange,symbol,signal):(async()=>{const pair=symbol+'USDT',meta=(await usdm.markets(signal)).get(pair);if(!meta)throw new UsdmHttpError('UNSUPPORTED',404);const raw=await usdm.snapshot(pair,signal),bids=raw.bids.map(([p,q])=>[+p,+q]),asks=raw.asks.map(([p,q])=>[+p,+q]);return {market,pair,quote:'USDT',tickSize:meta.tick,lastUpdateId:raw.lastUpdateId,eventAt:raw.T??raw.E,capturedAt:Date.now(),bids,asks,acquisitionMode:'cloud-fallback',verifiedBounds:{bid:Math.min(...bids.map(x=>x[0])),ask:Math.max(...asks.map(x=>x[0]))}};})();task=book.then(book=>Response.json({encoding:'normalized-book',market,symbol,exchange,book},{headers:{'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow'}})).catch(error=>Response.json({error:'EXCHANGE_UNAVAILABLE'},{status:error instanceof UsdmHttpError?error.status:502,headers:error instanceof UsdmHttpError&&error.retryAt?{'Retry-After':String(Math.max(1,Math.ceil((error.retryAt-Date.now())/1000)))}:{}})).finally(()=>pending.delete(key));pending.set(key,task);}
 return (await task).clone();
}
