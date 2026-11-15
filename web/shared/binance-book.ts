import {SequencedBook} from './exchanges';
import {ZONES,type Pair} from './model';

const MAX_BOOTSTRAP_AGE=15*60_000;
const INCOMPLETE_INNER_ZONE_RETRY=5*60_000;
function refreshFloor(initial:number){
 if(initial<=0)return 0;
 let floor=Math.min(25,Math.max(1,initial*0.25));
 if(floor>=initial)floor=initial*0.5;
 return floor;
}

export class BinanceBookSession {
 book=new SequencedBook();
 synchronized=false;
 private events:{data:any;at:number}[]=[];
 private cut:{target:number;book:SequencedBook|null}|null=null;
 refreshing=false;
 lastSnapshotAt=0;
 private bidFloor=0;
 private askFloor=0;
 needsRefresh(now:number){
  if(!this.synchronized||this.refreshing||now-this.lastSnapshotAt<5000)return false;
  const coverage=this.coverage();
  return !coverage||(this.bidFloor>0&&coverage.bidBps<this.bidFloor)||(this.askFloor>0&&coverage.askBps<this.askFloor)
   ||now-this.lastSnapshotAt>=MAX_BOOTSTRAP_AGE
   // The adaptive floor prevents total edge starvation, but a side can lose
   // our smallest complete zone long before that floor is crossed. If the
   // earlier refresh rule has not fired, retry REST5000 after five minutes.
   ||now-this.lastSnapshotAt>=INCOMPLETE_INNER_ZONE_RETRY&&(coverage.bidBps<ZONES[0][1]||coverage.askBps<ZONES[0][1]);
 }
 begin(now?:number){if(this.refreshing||this.synchronized&&(now===undefined||!this.needsRefresh(now)))return false;this.refreshing=true;this.events=[];return true;}
 cancel(){this.refreshing=false;this.events=[];}
 reset(){this.cancel();this.book.ready=false;this.synchronized=false;if(this.cut&&Date.now()<=this.cut.target)this.cut.book=null;}
 startCut(target:number){this.cut={target,book:this.synchronized&&this.book.ready&&this.book.at<=target?this.book.clone():null};}
 finishCut(target:number){
  const cut=this.cut;this.cut=null;
  const book=cut?.target===target?cut.book:null;
  const captured=!!book?.ready&&book.at<=target&&target-book.at<=45000;
  return {zones:captured?book!.snapshot(target):ZONES.map(()=>[null,null] as Pair),captured,at:book?.at??0};
 }
 receive(data:any,at:number){
  if(this.synchronized){
   try{this.book.diff(data,at);}catch(error){if(this.cut&&at<=this.cut.target)this.cut.book=null;throw error;}
  }
  if(this.cut?.book&&at<=this.cut.target){
   try{this.cut.book.diff(data,at);}catch{this.cut.book=null;}
  }
  if(!this.refreshing)return;
  // Continue serving the old, sequence-valid book while a new REST snapshot
  // is in flight. Replay the same deltas onto the replacement before swap.
  if(this.events.length>=4096){this.cancel();throw new Error('BINANCE_SNAPSHOT_BUFFER_OVERFLOW');}
  this.events.push({data,at});
 }
 install(raw:any,at:number){
  if(!this.refreshing)return;
  const next=new SequencedBook();
  if(this.synchronized&&this.book.ready)next.refresh(raw,at,this.book);
  else next.replace(raw,at);
  if(!next.ready){this.cancel();throw new Error('INVALID_BOOK');}
  const waiting=this.events.splice(0);
  try{for(const e of waiting)next.diff(e.data,Math.max(e.at,at));}catch(e){this.cancel();throw e;}
  // Only the refreshed REST5000 price interval is replaced; observed outer
  // levels remain until a sequence gap, deletion, or clean reconnect.
  this.book=next;this.synchronized=true;this.lastSnapshotAt=at;this.cancel();
  if(this.cut&&at<=this.cut.target)this.cut.book=next.clone();
  const coverage=this.coverage();this.bidFloor=refreshFloor(coverage?.bidBps??0);this.askFloor=refreshFloor(coverage?.askBps??0);
 }
 coverage(){
  if(!this.synchronized||!this.book.ready)return null;
  const bid=[...this.book.bids.keys()].reduce((a,b)=>Math.max(a,b),0),ask=[...this.book.asks.keys()].reduce((a,b)=>Math.min(a,b),Infinity),mid=(bid+ask)/2;
  return bid<ask&&Number.isFinite(mid)?{bidBps:Math.max(0,(mid-this.book.edges[0])/mid*10000),askBps:Math.max(0,(this.book.edges[1]-mid)/mid*10000),at:this.book.at,snapshotAt:this.lastSnapshotAt}:null;
 }
}
