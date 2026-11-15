import type {BookPatch} from './profile-books';

export type UsdmDiff={e?:string;s?:string;st?:number;U:number;u:number;pu:number;E?:number;T?:number;b:[string,string][];a:[string,string][]};
export type UsdmSnapshot={lastUpdateId:number;E?:number;T?:number;bids:[string,string][];asks:[string,string][]};
const read=(raw:[string,string][])=>raw.map(([p,q])=>{const price=Number(p),qty=Number(q);if(!Number.isFinite(price)||price<=0||!Number.isFinite(qty)||qty<0)throw new Error('INVALID_LEVEL');return [price,qty] as const;});
const floor=(initial:number)=>initial>0?Math.min(initial*.5,Math.min(25,Math.max(1,initial*.25))):0;

/** Indexed price heap: deletions remove entries, so churn cannot grow a lazy heap. */
export class PriceHeap {
 private prices:number[]=[];private positions=new Map<number,number>();
 constructor(private bid:boolean){}
 private before(a:number,b:number){return this.bid?a>b:a<b;}
 private swap(a:number,b:number){const p=this.prices;[p[a],p[b]]=[p[b],p[a]];this.positions.set(p[a],a);this.positions.set(p[b],b);}
 add(price:number){if(this.positions.has(price))return;let i=this.prices.push(price)-1;this.positions.set(price,i);while(i){const p=(i-1)>>>1;if(!this.before(this.prices[i],this.prices[p]))break;this.swap(i,p);i=p;}}
 delete(price:number){const found=this.positions.get(price);if(found===undefined)return;const last=this.prices.pop()!;this.positions.delete(price);if(found===this.prices.length)return;this.prices[found]=last;this.positions.set(last,found);let i=found;while(i){const p=(i-1)>>>1;if(!this.before(this.prices[i],this.prices[p]))break;this.swap(i,p);i=p;}while(i*2+1<this.prices.length){let c=i*2+1;if(c+1<this.prices.length&&this.before(this.prices[c+1],this.prices[c]))c++;if(!this.before(this.prices[c],this.prices[i]))break;this.swap(c,i);i=c;}}
 get best(){return this.prices[0]??0;}
}

export class UsdmBook {
 bids=new Map<number,number>();asks=new Map<number,number>();
 private bidPrices=new PriceHeap(true);private askPrices=new PriceHeap(false);
 ready=false;id=0;generation=0;activityAt=0;updateAt=0;eventAt=0;snapshotAt=0;lastRefreshAttempt=0;
 bounds={bid:Infinity,ask:0};private bidFloor=0;private askFloor=0;
 get mid(){const bid=this.bidPrices.best,ask=this.askPrices.best;return bid>0&&ask>bid?(bid+ask)/2:null;}
 private put(side:'bid'|'ask',price:number,qty:number){const map=side==='bid'?this.bids:this.asks,heap=side==='bid'?this.bidPrices:this.askPrices;if(qty===0){map.delete(price);heap.delete(price);}else{map.set(price,qty);heap.add(price);}}
 invalidate(){this.ready=false;}
 receive(e:UsdmDiff,at:number):BookPatch[]{
  if(![e.U,e.u,e.pu].every(Number.isSafeInteger)||e.U>e.u||e.pu>=e.u)throw new Error('INVALID_SEQUENCE');
  if(!this.ready)throw new Error('SNAPSHOT_MISSING');if(e.u<=this.id)return [];
  if(e.pu!==this.id)throw new Error('USDM_SEQUENCE_GAP');
  const sides=[['bid',read(e.b)],['ask',read(e.a)]] as const,patches=new Map<string,BookPatch>();
  for(const [side,levels]of sides)for(const [price,qty]of levels){const map=side==='bid'?this.bids:this.asks,key=side+':'+price;const old=patches.get(key)?.old??map.get(price)??0;this.put(side,price,qty);patches.set(key,{side,price,old,qty});}
  if(this.mid===null){for(const p of patches.values())this.put(p.side,p.price,p.old);throw new Error('INVALID_SPREAD');}
  this.id=e.u;this.activityAt=at;this.updateAt=at;this.eventAt=e.T??e.E??0;return [...patches.values()];
 }
 install(raw:UsdmSnapshot,events:readonly {data:UsdmDiff;at:number}[],at:number,retain=this.ready){
  if(!Number.isSafeInteger(raw.lastUpdateId))throw new Error('INVALID_SNAPSHOT');
  const waiting=events.filter(e=>e.data.u>=raw.lastUpdateId);
  if(!waiting.length)return false;
  const first=waiting[0].data;if(first.U>raw.lastUpdateId)throw new Error('SNAPSHOT_TOO_OLD');
  if(!(first.U<=raw.lastUpdateId&&first.u>=raw.lastUpdateId))return false;
  const bids=read(raw.bids).filter(([,q])=>q>0),asks=read(raw.asks).filter(([,q])=>q>0);
  if(!bids.length||!asks.length)throw new Error('INVALID_SNAPSHOT');
  const bounds={bid:Math.min(...bids.map(([p])=>p)),ask:Math.max(...asks.map(([p])=>p))};
  const next=new UsdmBook();for(const [p,q]of bids)next.put('bid',p,q);for(const [p,q]of asks)next.put('ask',p,q);
  if(retain){for(const [p,q]of this.bids)if(p<bounds.bid)next.put('bid',p,q);for(const [p,q]of this.asks)if(p>bounds.ask)next.put('ask',p,q);}
  next.id=raw.lastUpdateId;next.ready=true;
  // The bridge event is allowed to finish exactly at the snapshot ID.
  const bridge=waiting[0];next.id=bridge.data.pu;next.receive(bridge.data,bridge.at);
  for(const e of waiting.slice(1))next.receive(e.data,e.at);
  if(next.mid===null||retain&&next.id<this.id)throw new Error('SNAPSHOT_TOO_OLD');
  this.bids=next.bids;this.asks=next.asks;this.bidPrices=next.bidPrices;this.askPrices=next.askPrices;this.id=next.id;this.ready=true;
  const overlaps=retain&&bounds.bid<=this.bounds.ask&&bounds.ask>=this.bounds.bid;
  this.bounds=overlaps?{bid:Math.min(this.bounds.bid,bounds.bid),ask:Math.max(this.bounds.ask,bounds.ask)}:bounds;
  this.generation++;this.snapshotAt=at;this.activityAt=next.activityAt;this.updateAt=next.updateAt;this.eventAt=next.eventAt;
  const mid=this.mid!;this.bidFloor=floor(Math.max(0,(mid-bounds.bid)/mid*10000));this.askFloor=floor(Math.max(0,(bounds.ask-mid)/mid*10000));return true;
 }
 needsRefresh(now:number){if(!this.ready||now-this.lastRefreshAttempt<60000)return false;const mid=this.mid;if(mid===null)return false;return now-this.snapshotAt>=15*60000||(mid-this.bounds.bid)/mid*10000<this.bidFloor||(this.bounds.ask-mid)/mid*10000<this.askFloor;}
}
