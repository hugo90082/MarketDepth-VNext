import type {BookPatch,ProfileBookView} from '../../shared/profile-books';
type Side={prices:Float64Array;prefix:Float64Array};
const empty=():Side=>({prices:new Float64Array(),prefix:new Float64Array(1)});
const lower=(prices:Float64Array,value:number)=>{let a=0,b=prices.length;while(a<b){const m=(a+b)>>>1;if(prices[m]<value)a=m+1;else b=m;}return a;};
const yieldTask=()=>new Promise<void>(resolve=>setTimeout(resolve,0));
/** Immutable prefix base + net notional corrections. No book traversal on a pulse. */
export class ProfileIndex {
 private base={bid:empty(),ask:empty()};
 private delta={bid:new Map<number,number>(),ask:new Map<number,number>()};
 private replay=new Map<string,BookPatch>();private serial=0;building=false;ready=false;version=0;rebuilds=0;
 bestBid=0;bestAsk=0;
 get dirty(){return this.delta.bid.size+this.delta.ask.size;}
 patch(patches:BookPatch[]){if(this.building)for(const p of patches){const key=p.side+':'+p.price,previous=this.replay.get(key);this.replay.set(key,{...p,old:previous?.old??p.old});if(this.replay.size>100000){this.serial++;this.building=false;this.replay.clear();break;}}if(!this.ready)return;for(const p of patches)this.correct(p);this.version++;}
 private correct(p:BookPatch){const map=this.delta[p.side],value=(map.get(p.price)??0)+p.price*(p.qty-p.old);if(Math.abs(value)<1e-7)map.delete(p.price);else map.set(p.price,value);}
 cancel(){this.serial++;this.building=false;this.replay.clear();this.ready=false;}
 async rebuild(book:ProfileBookView,sorted?:{bids:[number,number][];asks:[number,number][]}){
  const serial=++this.serial,deadline=performance.now()+15000;this.building=true;this.replay.clear();this.rebuilds++;
  const current=()=>{if(serial!==this.serial)return false;if(performance.now()>deadline)throw new Error('PROFILE_INDEX_BUDGET');return true;};
  // Capture one fixed version synchronously, then build prefix segments off-task.
  const levels=sorted?{bid:sorted.bids,ask:sorted.asks}:{bid:[...book.bids],ask:[...book.asks]};
  const next={bid:empty(),ask:empty()};
  for(const side of ['bid','ask'] as const){
   const chunks:[number,number][][]=[];
   for(let i=0;i<levels[side].length;i+=4096){if(!current())return false;chunks.push(levels[side].slice(i,i+4096).sort((a,b)=>a[0]-b[0]));await yieldTask();}
   // Merge sorted chunks with a bounded heap instead of one blocking million-level sort.
   const heap:{chunk:number;index:number;price:number}[]=[];
   const push=(entry:typeof heap[number])=>{heap.push(entry);let i=heap.length-1;while(i){const parent=(i-1)>>>1;if(heap[parent].price<=entry.price)break;heap[i]=heap[parent];i=parent;}heap[i]=entry;};
   const pop=()=>{const top=heap[0],tail=heap.pop()!;if(heap.length){let i=0;while(i*2+1<heap.length){let child=i*2+1;if(child+1<heap.length&&heap[child+1].price<heap[child].price)child++;if(heap[child].price>=tail.price)break;heap[i]=heap[child];i=child;}heap[i]=tail;}return top;};
   chunks.forEach((c,i)=>{if(c.length)push({chunk:i,index:0,price:c[0][0]});});
   const prices=new Float64Array(levels[side].length),prefix=new Float64Array(prices.length+1);let i=0;
   while(heap.length){const node=pop(),[p,q]=chunks[node.chunk][node.index];prices[i]=p;prefix[i+1]=prefix[i]+p*q;i++;node.index++;if(node.index<chunks[node.chunk].length){node.price=chunks[node.chunk][node.index][0];push(node);}if(i%4096===0){await yieldTask();if(!current())return false;}}
   next[side]={prices,prefix};
  }
  if(!current())return false;
  this.base=next;this.delta={bid:new Map(),ask:new Map()};for(const p of this.replay.values())this.correct(p);
  this.replay.clear();this.building=false;this.ready=true;this.version++;this.updateBest();return true;
 }
 private updateBest(){
  const quantity=(side:'bid'|'ask',i:number)=>{const b=this.base[side],p=b.prices[i];return b.prefix[i+1]-b.prefix[i]+(this.delta[side].get(p)??0);};
  let bid=this.base.bid.prices.length-1;while(bid>=0&&quantity('bid',bid)<=1e-7)bid--;
  let ask=0;while(ask<this.base.ask.prices.length&&quantity('ask',ask)<=1e-7)ask++;
  this.bestBid=bid>=0?this.base.bid.prices[bid]:0;this.bestAsk=this.base.ask.prices[ask]??0;
  for(const [p,amount]of this.delta.bid)if(p>this.bestBid&&amount>0)this.bestBid=p;
  for(const [p,amount]of this.delta.ask)if((!this.bestAsk||p<this.bestAsk)&&amount>0)this.bestAsk=p;
 }
 midpoint(){this.updateBest();return this.bestBid>0&&this.bestAsk>this.bestBid?(this.bestBid+this.bestAsk)/2:null;}
 ranges(start:number,count:number,steps:number,tick:number,visibleLow=-Infinity,visibleHigh=Infinity){
  const result={bid:new Float64Array(count),ask:new Float64Array(count)};
  for(const side of ['bid','ask'] as const){const {prices,prefix}=this.base[side];for(let i=0;i<count;i++){const lo=Math.max(visibleLow,(start+i)*steps*tick),hi=Math.min(visibleHigh,(start+i+1)*steps*tick);result[side][i]=hi>lo?prefix[lower(prices,hi-tick*1e-7)]-prefix[lower(prices,lo-tick*1e-7)]:0;}
   for(const [p,amount]of this.delta[side]){const i=Math.floor(Math.round(p/tick)/steps)-start;if(i>=0&&i<count&&p>=visibleLow-tick*1e-7&&p<visibleHigh-tick*1e-7)result[side][i]+=amount;}
   for(let i=0;i<count;i++)result[side][i]=Math.max(0,result[side][i]);
  }return result;
 }
}
