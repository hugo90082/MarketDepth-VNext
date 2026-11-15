import type {ProfileSource,ProfileMarket} from './order-book-profile';
export type BookPatch={side:'bid'|'ask';price:number;old:number;qty:number};
export type ProfileBookView={bids:ReadonlyMap<number,number>;asks:ReadonlyMap<number,number>;ready:boolean;activityAt:number;updateAt:number;snapshotAt:number;tick:number;bounds?:{bid:number;ask:number};complete:boolean;fallback?:boolean;generation?:number;eventAt?:number;phase?:string};
export type ProfileBookEvent={key:string;type:'reset'|'patch'|'status';patches?:BookPatch[];continuous?:boolean};
const readers=new Map<string,()=>ProfileBookView>(),listeners=new Set<(e:ProfileBookEvent)=>void>();
const interest=new Set<string>();
export const profileBookInterested=(key:string)=>interest.has(key);
export function setProfileBookInterest(keys:Iterable<string>){interest.clear();for(const key of keys)interest.add(key);}
export const bookKey=(source:ProfileSource,asset:string,market:ProfileMarket='spot')=>(market==='usdm'?'usdm:':'')+source+':'+asset;
export function registerProfileBook(key:string,read:()=>ProfileBookView){if(!/^(?:(?:binance|coinbase):|usdm:binance:)(BTC|ETH|SOL)$/.test(key))return;readers.set(key,read);emitProfileBook({key,type:'reset'});}
export const readProfileBook=(key:string)=>readers.get(key)?.();
export function emitProfileBook(event:ProfileBookEvent){for(const listener of listeners)listener(event);}
export function observeProfileBooks(listener:(e:ProfileBookEvent)=>void){listeners.add(listener);return()=>{listeners.delete(listener);};}
