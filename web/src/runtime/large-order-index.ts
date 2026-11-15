import type {Asset} from '../../shared/model';
import type {BookPatch,ProfileBookView} from '../../shared/profile-books';
import {PriceHeap} from '../../shared/usdm-book';
import {largeOrderThreshold} from '../../shared/order-book-profile';

type Candidate={price:number;amount:number;observedAt:number|null|undefined};
type Node={value:Candidate;priority:number;left:Node|null;right:Node|null};
const hash=(price:number)=>{let h=2166136261;for(const c of String(price))h=Math.imul(h^c.charCodeAt(0),16777619);return h>>>0;};
const merge=(a:Node|null,b:Node|null):Node|null=>{if(!a)return b;if(!b)return a;if(a.priority<b.priority){a.right=merge(a.right,b);return a;}b.left=merge(a,b.left);return b;};
class Candidates {
 private root:Node|null=null;size=0;
 get(price:number){let n=this.root;while(n){if(price===n.value.price)return n.value;n=price<n.value.price?n.left:n.right;}return undefined;}
 put(value:Candidate){const exists=!!this.get(value.price);const insert=(n:Node|null):Node=>{if(!n)return {value,priority:hash(value.price),left:null,right:null};if(value.price===n.value.price){n.value=value;return n;}if(value.price<n.value.price){n.left=insert(n.left);if(n.left.priority<n.priority){const l=n.left;n.left=l.right;l.right=n;return l;}}else{n.right=insert(n.right);if(n.right.priority<n.priority){const r=n.right;n.right=r.left;r.left=n;return r;}}return n;};this.root=insert(this.root);if(!exists)this.size++;}
 delete(price:number){if(!this.get(price))return;const remove=(n:Node|null):Node|null=>{if(!n)return null;if(price===n.value.price)return merge(n.left,n.right);if(price<n.value.price)n.left=remove(n.left);else n.right=remove(n.right);return n;};this.root=remove(this.root);this.size--;}
 *range(low:number,high:number):Generator<Candidate>{function* visit(n:Node|null):Generator<Candidate>{if(!n)return;if(n.value.price>=low)yield* visit(n.left);if(n.value.price>=low&&n.value.price<=high)yield n.value;if(n.value.price<=high)yield* visit(n.right);}yield* visit(this.root);}
}
const tick=()=>new Promise<void>(r=>setTimeout(r,0));
/** Price membership and threshold episodes are maintained on applied events, not display pulses. */
export class LargeOrderIndex {
 private sides={bid:new Candidates(),ask:new Candidates()};
 private heaps={bid:new PriceHeap(true),ask:new PriceHeap(false)};
 private bounds:{low:number;high:number}|null=null;
 private serial=0;private journal:{patches:BookPatch[];at:number}[]=[];private bytes=0;
 private changed=new Set<string>();
 ready=false;building=false;fallback=false;version=0;rebuilds=0;
 constructor(readonly asset:Asset){}
 get mid(){const b=this.heaps.bid.best,a=this.heaps.ask.best;return b>0&&a>b?(b+a)/2:null;}
 get count(){return this.sides.bid.size+this.sides.ask.size;}
 get dirty(){return this.changed.size;}
 private observe(value:Candidate,at:number){const inside=!!this.bounds&&value.price>=this.bounds.low&&value.price<=this.bounds.high;if(!inside)value.observedAt=undefined;else if(value.amount>=largeOrderThreshold(this.asset)&&value.observedAt===undefined)value.observedAt=this.fallback?null:at;}
 private move(at:number){const mid=this.mid,next=mid===null?null:{low:mid*.9,high:mid*1.1},old=this.bounds;this.bounds=next;
  for(const side of ['bid','ask'] as const){const tree=this.sides[side];if(!old){if(next)for(const value of tree.range(next.low,next.high))this.observe(value,at);continue;}if(!next){for(const value of tree.range(old.low,old.high))value.observedAt=undefined;continue;}
   // Only candidates crossing a boundary need their episode reconsidered.
   for(const [lo,hi]of [[Math.min(old.low,next.low),Math.max(old.low,next.low)],[Math.min(old.high,next.high),Math.max(old.high,next.high)]])for(const value of tree.range(lo,hi))this.observe(value,at);
  }
 }
 patch(patches:BookPatch[],at:number){
  if(this.building){this.bytes+=patches.length*48;this.journal.push({patches,at});if(this.journal.length>4096||this.bytes>16*1024*1024){this.serial++;this.building=false;this.journal=[];}}
  if(!this.ready)return;
  for(const p of patches)if(this.changed.size<20000)this.changed.add(p.side+':'+p.price);
  for(const p of patches){if(p.qty>0)this.heaps[p.side].add(p.price);else this.heaps[p.side].delete(p.price);}
  this.move(at);
  for(const p of patches){const tree=this.sides[p.side],amount=p.price*p.qty;if(amount<largeOrderThreshold(this.asset)/2||p.qty===0){tree.delete(p.price);continue;}const old=tree.get(p.price),value={price:p.price,amount,observedAt:old?.observedAt};this.observe(value,at);tree.put(value);}
  this.version++;
 }
 cancelRebuild(){this.serial++;this.building=false;this.journal=[];}
 invalidate(){this.cancelRebuild();this.ready=false;this.changed.clear();this.sides={bid:new Candidates(),ask:new Candidates()};this.heaps={bid:new PriceHeap(true),ask:new PriceHeap(false)};this.bounds=null;}
 async rebuild(book:ProfileBookView,levels:{bids:[number,number][];asks:[number,number][]},continuous:boolean,at:number){
  const serial=++this.serial,deadline=performance.now()+15000;this.rebuilds++;this.building=true;this.journal=[];this.bytes=0;
  const old=continuous&&this.ready?this.sides:null,next=new LargeOrderIndex(this.asset);next.fallback=!!book.fallback;
  // Save only candidate episode state. Never retain an old mutable tree as a snapshot.
  const starts={bid:new Map<number,number|null>(),ask:new Map<number,number|null>()};if(old)for(const side of ['bid','ask'] as const)for(const v of old[side].range(0,Infinity))if(v.observedAt!==undefined)starts[side].set(v.price,v.observedAt);
  for(const [side,data]of [['bid',levels.bids],['ask',levels.asks]] as const){for(let i=0;i<data.length;i++){const [price,qty]=data[i];if(qty>0){next.heaps[side].add(price);if(price*qty>=largeOrderThreshold(this.asset)/2)next.sides[side].put({price,amount:price*qty,observedAt:starts[side].get(price)});}if(i%4096===4095){await tick();if(serial!==this.serial)return false;if(performance.now()>deadline)throw new Error('LARGE_ORDER_INDEX_BUDGET');}}}
  next.ready=true;next.move(at);for(const side of ['bid','ask'] as const)for(const value of next.sides[side].range(0,Infinity))next.observe(value,at);
  for(const event of this.journal)next.patch(event.patches,event.at);
  if(serial!==this.serial)return false;
  this.sides=next.sides;this.heaps=next.heaps;this.bounds=next.bounds;this.changed=next.changed;this.fallback=next.fallback;this.journal=[];this.bytes=0;this.building=false;this.ready=true;this.version++;return true;
 }
 levels(side:'bid'|'ask',low:number,high:number){if(!this.ready||!this.bounds)return [];return [...this.sides[side].range(Math.max(low,this.bounds.low),Math.min(high,this.bounds.high))].filter(v=>v.amount>=largeOrderThreshold(this.asset)&&v.observedAt!==undefined);}
}
