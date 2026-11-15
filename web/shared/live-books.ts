import { ZONES, type Asset, type Pair } from './model';
import { zonesOf, type Book } from './exchanges';
import type {BookPatch} from './profile-books';

const blank=()=>ZONES.map(()=>[null,null] as Pair);
export const crc32=(text:string)=>{let value=~0;for(const byte of new TextEncoder().encode(text)){value^=byte;for(let i=0;i<8;i++)value=(value>>>1)^((value&1)?0xedb88320:0);}return (value^~0)>>>0;};
type DecimalLevel=[string,string];
const sorted=(map:Map<number,DecimalLevel>,side:'bids'|'asks')=>[...map].sort((a,b)=>side==='bids'?b[0]-a[0]:a[0]-b[0]);
function topTen(map:Map<number,DecimalLevel>,side:'bids'|'asks'){
 const top:[number,DecimalLevel][]=[];
 for(const entry of map){let index=0;while(index<top.length&&(side==='bids'?top[index][0]>entry[0]:top[index][0]<entry[0]))index++;if(index<10){top.splice(index,0,entry);if(top.length>10)top.pop();}}
 return top.map(([,level])=>level);
}
const decimalPart=(value:string)=>value.replace('.','').replace(/^0+/,'')||'0';

/** Preserve decimal spelling (including trailing zeroes) before JSON loses it. */
export function parseKrakenMessage(raw:string):any {
 return JSON.parse(raw.replace(/("(?:price|qty)"\s*:\s*)(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|"(?:\\.|[^"\\])*"/g,(token,key,value)=>key?key+JSON.stringify(expandDecimal(value)):token));
}
function expandDecimal(value:string):string {
 if(!/[eE]/.test(value))return value;
 const [mantissa,exponent]=value.toLowerCase().split('e'),[whole,fraction='']=mantissa.split('.');
 const digits=whole+fraction,point=whole.length+Number(exponent);
 return point<=0?'0.'+'0'.repeat(-point)+digits:point>=digits.length?digits+'0'.repeat(point-digits.length):digits.slice(0,point)+'.'+digits.slice(point);
}

export class KrakenLiveBook {
 private sides={bids:new Map<number,DecimalLevel>(),asks:new Map<number,DecimalLevel>()};
 ready=false;at=0;
 heartbeat(at:number){if(this.ready)this.at=at;}
 update(data:any,type:string,at:number){
  if(type==='snapshot'){this.sides={bids:new Map(),asks:new Map()};this.ready=false;}
  else if(!this.ready)throw new Error('KRAKEN_SNAPSHOT_MISSING');
  for(const side of ['bids','asks'] as const)for(const level of data[side]??[]){
   const price=String(level.price),qty=String(level.qty);
   if(!Number.isFinite(Number(price))||Number(price)<=0||!Number.isFinite(Number(qty))||Number(qty)<0)throw new Error('KRAKEN_INVALID_LEVEL');
   // Numeric identity is separate from the exact spelling used for the CRC.
   if(Number(qty)===0)this.sides[side].delete(Number(price));else this.sides[side].set(Number(price),[price,qty]);
  }
  for(const side of ['bids','asks'] as const)if(this.sides[side].size>1000)this.sides[side]=new Map(sorted(this.sides[side],side).slice(0,1000));
  if(data.checksum!==undefined){
   const text=(['asks','bids'] as const).flatMap(side=>topTen(this.sides[side],side).map(([p,q])=>decimalPart(p)+decimalPart(q))).join('');
   if(crc32(text)!==(Number(data.checksum)>>>0)){this.ready=false;throw new Error('KRAKEN_CHECKSUM');}
  }
  this.ready=this.sides.bids.size>0&&this.sides.asks.size>0;this.at=at;
 }
 snapshot(target:number):Pair[]{
  if(!this.ready||this.at>target||target-this.at>45000)return blank();
  return zonesOf({bids:[...this.sides.bids.values()].map(([p,q])=>[Number(p),Number(q)]),asks:[...this.sides.asks.values()].map(([p,q])=>[Number(p),Number(q)])});
 }
}

type BitfinexChannel={asset:Asset;precision:'P1'|'P2';bids:Map<number,number>;asks:Map<number,number>;ready:boolean;at:number};
export class BitfinexLiveBooks {
 private channels=new Map<number,BitfinexChannel>();
 private byKey=new Map<string,BitfinexChannel>();
 invalidate(){this.channels.clear();this.byKey.clear();}
 subscribe(id:number,asset:Asset,precision:'P1'|'P2'){
  const channel={asset,precision,bids:new Map<number,number>(),asks:new Map<number,number>(),ready:false,at:0};
  this.channels.set(id,channel);this.byKey.set(asset+precision,channel);
 }
 update(message:any,at:number){
  const channel=this.channels.get(Number(message?.[0]));if(!channel)return;
  if(message[1]==='hb'){if(channel.ready)channel.at=at;return;}
  if(message[1]==='cs'){
   const bids=[...channel.bids].sort((a,b)=>b[0]-a[0]).slice(0,25),asks=[...channel.asks].sort((a,b)=>a[0]-b[0]).slice(0,25);
   const parts:string[]=[];for(let i=0;i<25;i++){if(bids[i])parts.push(String(bids[i][0]),String(bids[i][1]));if(asks[i])parts.push(String(asks[i][0]),String(-asks[i][1]));}
   if((crc32(parts.join(':'))|0)!==(Number(message[2])|0)){channel.ready=false;throw new Error('BITFINEX_CHECKSUM');}
   if(channel.ready)channel.at=at;
   return;
  }
  const snapshot=Array.isArray(message[1])&&Array.isArray(message[1][0]);
  if(snapshot){channel.bids.clear();channel.asks.clear();}
  else if(!channel.ready)throw new Error('BITFINEX_SNAPSHOT_MISSING');
  const entries=snapshot?message[1]:[message[1]];
  for(const [rawPrice,rawCount,rawAmount] of entries){
   const price=Number(rawPrice),count=Number(rawCount),amount=Number(rawAmount);
   if(!Number.isFinite(price)||price<=0||!Number.isFinite(count)||!Number.isFinite(amount))throw new Error('BITFINEX_INVALID_LEVEL');
   const side=amount>0?channel.bids:channel.asks;
   if(count===0)side.delete(price);else side.set(price,Math.abs(amount));
  }
  for(const side of [channel.bids,channel.asks])if(side.size>250){
   const ordered=[...side].sort((a,b)=>side===channel.bids?b[0]-a[0]:a[0]-b[0]).slice(0,250);
   side.clear();for(const [p,q]of ordered)side.set(p,q);
  }
  channel.ready=channel.bids.size>0&&channel.asks.size>0;channel.at=at;
 }
 snapshot(asset:Asset,target:number){
  const zone=(precision:'P1'|'P2')=>{
   const c=this.byKey.get(asset+precision);if(!c?.ready||c.at>target||target-c.at>45000)return blank();
   const book:Book={bids:[...c.bids],asks:[...c.asks]};return zonesOf(book);
  };
  const near=zone('P1'),broad=zone('P2');
  const fresh=(precision:'P1'|'P2')=>{const c=this.byKey.get(asset+precision);return !!c?.ready&&c.at<=target&&target-c.at<=45000;};
  return {zones:[near[0],...broad.slice(1)],nearReady:fresh('P1'),broadReady:fresh('P2')};
 }
}

export class CoinbaseLiveBook {
 private bids=new Map<number,number>();private asks=new Map<number,number>();
 ready=false;at=0;updateAt=0;snapshotAt=0;generation=0;
 constructor(private changed:(type:'reset'|'patch',patches:BookPatch[])=>void=()=>{},private observing:()=>boolean=()=>true){}
 view(){return {bids:this.bids as ReadonlyMap<number,number>,asks:this.asks as ReadonlyMap<number,number>,ready:this.ready,activityAt:this.at,updateAt:this.updateAt,snapshotAt:this.snapshotAt,generation:this.generation};}
 heartbeat(at:number){if(this.ready)this.at=at;}
 update(data:any,at:number){
  const patches:BookPatch[]=[];
  if(data.type==='snapshot'){this.generation++;this.bids.clear();this.asks.clear();this.ready=false;
   for(const side of ['bids','asks'] as const)for(const [p,q] of data[side]??[])this.level(side==='bids'?this.bids:this.asks,p,q);
   this.ready=this.bids.size>0&&this.asks.size>0;this.snapshotAt=at;
  }else if(data.type==='l2update'){
   if(!this.ready)throw new Error('COINBASE_SNAPSHOT_MISSING');
   for(const [side,p,q]of data.changes??[]){if(side!=='buy'&&side!=='sell')throw new Error('COINBASE_INVALID_SIDE');const map=side==='buy'?this.bids:this.asks,price=Number(p),old=map.get(price)??0;this.level(map,p,q);if(this.observing())patches.push({side:side==='buy'?'bid':'ask',price,old,qty:Number(q)});}
  }
  if(this.bids.size+this.asks.size>1000000){this.ready=false;throw new Error('COINBASE_BOOK_TOO_LARGE');}
  this.at=at;this.updateAt=at;
  if(this.ready&&(data.type==='snapshot'||this.observing()))this.changed(data.type==='snapshot'?'reset':'patch',patches);
 }
 private level(side:Map<number,number>,p:any,q:any){const price=Number(p),qty=Number(q);if(!Number.isFinite(price)||price<=0||!Number.isFinite(qty)||qty<0)throw new Error('COINBASE_INVALID_LEVEL');if(qty===0)side.delete(price);else side.set(price,qty);}
 rawBook(target:number){return this.ready&&this.at<=target&&target-this.at<=45000?{bids:[...this.bids] as [number,number][],asks:[...this.asks] as [number,number][]}:null;}
 snapshot(target:number):Pair[]{return this.ready&&this.at<=target&&target-this.at<=45000?zonesOf({bids:[...this.bids],asks:[...this.asks]}):blank();}
}
