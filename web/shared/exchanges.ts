import { ZONES, type Asset, type Pair } from './model';
export type Level = [number,number];
export type Book = { bids:Level[]; asks:Level[] };
export const kinds=['binance-book','coinbase','kraken-grouped','kraken-depth','bitfinex-near','bitfinex-broad'] as const;
export type BookKind=typeof kinds[number];
export const bitfinexPrecisions=['P1','P2'] as const;
export function binanceDepthStream(asset:Asset){return `wss://data-stream.binance.vision:443/ws/${asset.toLowerCase()}usdt@depth@100ms`;}
export function endpoint(kind:BookKind,asset:Asset) {
  const pair=asset==='BTC'?'XBTUSD':asset+'USD';
  switch(kind){
    case 'binance-book':return `https://data-api.binance.vision/api/v3/depth?symbol=${asset}USDT&limit=5000`;
    case 'coinbase':return `https://api.exchange.coinbase.com/products/${asset}-USD/book?level=2`;
    case 'kraken-grouped':return `https://api.kraken.com/0/public/GroupedBook?pair=${pair}&depth=1000&grouping=1000`;
    case 'kraken-depth':return `https://api.kraken.com/0/public/Depth?pair=${pair}&count=500`;
    case 'bitfinex-near':case 'bitfinex-broad':return `https://api-pub.bitfinex.com/v2/book/t${asset}USD/${kind==='bitfinex-near'?'P1':'P2'}?len=250`;
  }
}
function levels(raw:any):Level[]{if(!Array.isArray(raw))throw new Error('INVALID_BOOK');return raw.map((r:any)=>[Number(r[0]),Number(r[1])] as Level).filter(([p,q])=>Number.isFinite(p)&&Number.isFinite(q)&&p>0&&q>0);}
export function parseBook(kind:BookKind,data:any):Book {
  if(kind.startsWith('bitfinex')){
    if(!Array.isArray(data))throw new Error('INVALID_BOOK');
    return {bids:data.filter(r=>Number(r[2])>0&&Number(r[1])>0).map(r=>[Number(r[0]),Number(r[2])]),asks:data.filter(r=>Number(r[2])<0&&Number(r[1])>0).map(r=>[Number(r[0]),-Number(r[2])])};
  }
  if(kind.startsWith('kraken')) {
    if(data.error?.length)throw new Error('INVALID_BOOK');
    data=kind==='kraken-grouped'?data.result:Object.values(data.result??{})[0];
    const parse=kind==='kraken-grouped'
      ?(raw:any):Level[]=>{if(!Array.isArray(raw))throw new Error('INVALID_BOOK');return raw.map((r:any)=>[Number(r.price),Number(r.qty)] as Level).filter(([p,q])=>Number.isFinite(p)&&Number.isFinite(q)&&p>0&&q>0);}
      :levels;
    return {bids:parse(data?.bids),asks:parse(data?.asks)};
  }
  return {bids:levels(data?.bids),asks:levels(data?.asks)};
}
export function zonesOf(book:Book,observedEdges?:[number,number]):Pair[] {
  const out=ZONES.map(()=>[null,null] as Pair);
  if(!book.bids.length||!book.asks.length)return out;
  const bid=book.bids.reduce((n,r)=>Math.max(n,r[0]),-Infinity),ask=book.asks.reduce((n,r)=>Math.min(n,r[0]),Infinity),mid=(bid+ask)/2;
  if(bid>=ask||!Number.isFinite(mid)||mid<=0)return out;
  const edges=observedEdges??[book.bids.reduce((n,r)=>Math.min(n,r[0]),Infinity),book.asks.reduce((n,r)=>Math.max(n,r[0]),-Infinity)];
  const coverage=[edges[0]>0&&edges[0]<mid?(mid-edges[0])/mid*10000:0,edges[1]>mid?(edges[1]-mid)/mid*10000:0];
  for(let side=0;side<2;side++)for(let i=0;i<ZONES.length;i++){
    const [low,high]=ZONES[i];if(coverage[side]+1e-9<high)continue;
    let total=0;for(const [p,q]of side===0?book.bids:book.asks){const d=(side===0?mid-p:p-mid)/mid*10000;if(p>0&&q>0&&d>=low&&d<high)total+=p*q;}
    out[i][side]=Number.isFinite(total)?total:null;
  }
  return out;
}
export function fillMissing(exact:Pair[],broad:Pair[]):Pair[]{return exact.map((p,i)=>[p[0]??broad[i][0],p[1]??broad[i][1]]);}
function edgeOf(levels:Map<number,number>,side:'bids'|'asks'){
 let edge=side==='bids'?Infinity:-Infinity;
 for(const price of levels.keys())edge=side==='bids'?Math.min(edge,price):Math.max(edge,price);
 return Number.isFinite(edge)?edge:0;
}
export class SequencedBook {
  bids=new Map<number,number>();asks=new Map<number,number>();edges:[number,number]=[0,0];id=0;at=0;ready=false;
 clone(){const book=new SequencedBook();book.bids=new Map(this.bids);book.asks=new Map(this.asks);book.edges=[...this.edges];book.id=this.id;book.at=this.at;book.ready=this.ready;return book;}
  replace(raw:any,at:number){const b=parseBook('binance-book',raw);this.bids=new Map(b.bids);this.asks=new Map(b.asks);this.edges=[edgeOf(this.bids,'bids'),edgeOf(this.asks,'asks')];this.id=Number(raw.lastUpdateId);this.at=at;this.ready=Number.isSafeInteger(this.id)&&b.bids.length>0&&b.asks.length>0;}
  refresh(raw:any,at:number,previous:SequencedBook){
   this.replace(raw,at);
   if(!this.ready)return;
   // A new REST5000 snapshot owns every price nearer than its outer edge.
   // Only sequence-maintained levels farther away can survive the refresh.
   const [bidEdge,askEdge]=this.edges;
   for(const [price,qty] of previous.bids)if(price<bidEdge)this.bids.set(price,qty);
   for(const [price,qty] of previous.asks)if(price>askEdge)this.asks.set(price,qty);
   this.edges=[edgeOf(this.bids,'bids'),edgeOf(this.asks,'asks')];
  }
  diff(e:any,at:number){
   if(e.u<=this.id)return;
   if(!this.ready||e.U>this.id+1||e.u<this.id+1){this.ready=false;throw new Error('BOOK_SEQUENCE_GAP');}
   let bidEdgeDeleted=false,askEdgeDeleted=false;
   for(const [raw,map,side]of [[e.b,this.bids,0],[e.a,this.asks,1]] as const)for(const [price,qty]of raw){
    const p=Number(price),q=Number(qty);if(!Number.isFinite(p)||!Number.isFinite(q)||p<=0)continue;
    if(q===0){if(map.delete(p)&&p===this.edges[side]){if(side===0)bidEdgeDeleted=true;else askEdgeDeleted=true;}}
    else if(q>0){map.set(p,q);if(side===0)this.edges[0]=Math.min(this.edges[0],p);else this.edges[1]=Math.max(this.edges[1],p);}
   }
   if(bidEdgeDeleted)this.edges[0]=edgeOf(this.bids,'bids');
   if(askEdgeDeleted)this.edges[1]=edgeOf(this.asks,'asks');
   if(!this.bids.size||!this.asks.size){this.ready=false;throw new Error('BOOK_EMPTY_SIDE');}
   this.id=e.u;this.at=at;
  }
  snapshot(target:number):Pair[]{return this.ready&&this.at<=target&&target-this.at<=45000?zonesOf({bids:[...this.bids],asks:[...this.asks]},this.edges):ZONES.map(()=>[null,null]);}
}
