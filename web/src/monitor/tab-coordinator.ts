import {marketRuntime} from '../runtime/client';
import type {DepthResponse} from './depth-types';
import type {MarketMetaBatchResponse} from './market-meta';
type Callbacks={onLeaderChange:(leader:boolean)=>void;onSnapshot:(symbol:string,payload:DepthResponse)=>void;onMarketMeta:(payload:MarketMetaBatchResponse)=>void;onSettings:()=>void;onAlert:(entry:unknown)=>void;onClearHistory:()=>void};
/** Monitoring uses the application's one collector; it never elects a second one. */
export function createTabCoordinator(callbacks:Callbacks){
 const update=()=>callbacks.onLeaderChange(marketRuntime.isLeader());
 const unsub=marketRuntime.subscribe(update);update();
 const unlisten=marketRuntime.events(m=>{
  if(m.type==='snapshot')callbacks.onSnapshot(m.symbol,m.payload);
  if(m.type==='market-meta')callbacks.onMarketMeta(m.payload);
  if(m.type==='settings')callbacks.onSettings();
  if(m.type==='alert')callbacks.onAlert(m.entry);
  if(m.type==='clear-history')callbacks.onClearHistory();
 });
 return {id:marketRuntime.state().owner,isLeader:marketRuntime.isLeader,
  publishSnapshot:(symbol:string,payload:DepthResponse)=>marketRuntime.publish({type:'snapshot',symbol,payload}),
  publishMarketMeta:(payload:MarketMetaBatchResponse)=>marketRuntime.publish({type:'market-meta',payload}),
  publishSettings:()=>marketRuntime.publish({type:'settings'}),publishAlert:(entry:unknown)=>marketRuntime.publish({type:'alert',entry}),
  publishClearHistory:()=>marketRuntime.publish({type:'clear-history'}),stop(){unsub();unlisten();},
 };
}
