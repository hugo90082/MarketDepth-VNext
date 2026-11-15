import { endpoint, type BookKind } from '../shared/exchanges';
import { CONTRACT } from '../shared/contract';
import type { Asset } from '../shared/model';
import { claim, release, readSnapshot, saveSnapshot, type Env } from './db';
import { checkResponse } from './history';

export async function exchangeView(env:Env,kind:BookKind,asset:Asset,fetcher:typeof fetch=fetch,now=Date.now()) {
  // Keep pre-P1 near-side snapshots out of the new fixed acquisition regime.
  const key=`v3-exchange-${kind.startsWith('bitfinex')?'p1p2-':''}${kind}-${asset}`,existing=await readSnapshot<any>(env.DB,key);
  if(existing&&now-existing.receivedAtMs<2000)return {...existing,cached:true};
  const owner=crypto.randomUUID();
  if(!await claim(env.DB,key,now,owner,15000,2000)){
    if(existing)return {...existing,cached:true};
    throw new Error('EXCHANGE_BUSY');
  }
  const venue=kind.split('-')[0],venueKey='v3-exchange-budget-'+venue;
  const spacing=venue==='binance'?5000:venue==='bitfinex'?2000:1000;
  if(!await claim(env.DB,venueKey,now,owner,15000,spacing)){
    await release(env.DB,key,owner,now+1000);
    if(existing)return {...existing,cached:true};
    throw new Error('EXCHANGE_BUSY');
  }
  let next=now+2000,venueNext=now+spacing;
  try {
    const r=await checkResponse(await fetcher(endpoint(kind,asset),{redirect:'manual',signal:AbortSignal.timeout(8000)}),Date.now());
    const data=await r.json();const value={ok:true,...CONTRACT,encoding:'raw-book',kind,asset,data,receivedAtMs:Date.now(),cached:false};
    await saveSnapshot(env.DB,key,value,Date.now());return value;
  }catch(e){next=Date.now()+Math.max(30000,(e as {retryMs?:number}).retryMs??0);venueNext=Math.max(venueNext,next);throw e;}
  finally{await release(env.DB,key,owner,next);await release(env.DB,venueKey,owner,venueNext);}
}
