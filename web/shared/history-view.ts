import {ASSETS,VENUES,depth,type Pair,type ViewStats,type Asset,type Venue} from './model';
import {emptyRow,CONTRACT,type StoredRow,type StoredCandle,type Interval} from './contract';
export const VIEW_ZONES=[[0],[1],[2],[3],[4],[0,1],[0,1,2],[0,1,2,3],[0,1,2,3,4]];
export const viewChoice=(zones:number[])=>VIEW_ZONES.findIndex(z=>z.join(',')===[...zones].sort((a,b)=>a-b).join(','));
const matrix=<T>(make:()=>T)=>Array.from({length:5},()=>ASSETS.map(()=>VIEW_ZONES.map(make)));
export type DepthViewSelection={venue:Venue;assets:readonly Asset[];zones:number[][]};
const EMPTY_DEPTH=emptyRow(0).d;
export class DepthViewAccumulator{
 private bins=new Map<number,{values:Pair[][][];stats:ViewStats[][][];frames:number;lastFrame:number;last:number}>();latest:StoredRow|undefined;
 constructor(private interval:Interval,private from:number,private to:number,private selection?:DepthViewSelection){}
 add(row:StoredRow){if(row.t<this.from||row.t>this.to)return;if(!this.latest||this.latest.t<row.t)this.latest=row;const t=Math.floor(row.t/this.interval)*this.interval;
  const b=this.bins.get(t)??{values:[],stats:[],frames:0,lastFrame:-1,last:row.a};this.bins.set(t,b);if(b.lastFrame===row.t)return;b.frames++;b.lastFrame=row.t;b.last=Math.max(b.last,row.a);
  for(let vi=0;vi<5;vi++)for(let ai=0;ai<3;ai++)for(let zi=0;zi<VIEW_ZONES.length;zi++){
   const zones=VIEW_ZONES[zi],venue=vi===4?'all4':VENUES[vi];if(this.selection&&(venue!==this.selection.venue||!this.selection.assets.includes(ASSETS[ai])||!this.selection.zones.some(z=>viewChoice(z)===zi)))continue;
   b.values[vi]??=[];b.values[vi][ai]??=[];b.stats[vi]??=[];b.stats[vi][ai]??=[];b.values[vi][ai][zi]??=[0,0];b.stats[vi][ai][zi]??={available:0,full:0,partial:0,unknown:0,final:0,backendValid:0,backendNull:0,backendZero:0};
   const part=depth(row,ASSETS[ai],venue,zones),pair=b.values[vi][ai][zi],s=b.stats[vi][ai][zi],selected=vi===4?[0,1,2,3]:[vi];
   if(part.bid===null||part.ask===null){pair[0]=pair[1]=null;}else if(pair[0]!==null&&pair[1]!==null){pair[0]+=part.bid;pair[1]+=part.ask;}
   if(part.ratio!==null){s.available++;const quality=selected.map(v=>row.quality?.books[v]?.[ai]);if(quality.every(q=>q&&zones.every(z=>q.complete[z])))s.full++;else if(quality.some(q=>q&&zones.some(z=>!q.complete[z])))s.partial++;else s.unknown++;}
   if(row.source==='railway'&&Number.isSafeInteger(row.finalVersion)){s.final++;if(part.ratio!==null)s.backendValid++;if(selected.some(v=>zones.some(z=>row.d[v][ai][z].some(n=>n===null))))s.backendNull++;if(part.bid!==null&&part.ask!==null&&part.bid+part.ask===0)s.backendZero++;}
  }
 }
 result(){const rows:StoredRow[]=[];for(const [t,b]of [...this.bins].sort(([a],[b])=>a-b)){const expected=(Math.min(t+this.interval,Math.floor(this.to/60000)*60000+60000)-t)/60000;
  if(b.frames<expected)for(const v of b.values)if(v)for(const a of v)if(a)for(const p of a)if(p)p[0]=p[1]=null;
  rows.push({t,d:EMPTY_DEPTH,a:b.last,cadence:60000,source:'browser',format:CONTRACT.datasetFormat,bucket:{interval:this.interval,values:b.values,stats:b.stats,observed:b.frames}});
 }if(this.latest)rows.push(this.latest);return rows;}
}
export class CandleViewAccumulator{
 private bins=new Map<number,{c:StoredCandle;count:number;first:number;last:number;mask:bigint}>();private tail=new Map<number,StoredCandle>();
 constructor(private asset:Asset,private interval:Interval,private from:number,private to:number){}
 add(c:StoredCandle){if(c.t<this.from||c.t>this.to||c.interval!==60000)return;const t=Math.floor(c.t/this.interval)*this.interval;if(t===Math.floor(this.to/this.interval)*this.interval){if(!this.tail.has(c.t))this.tail.set(c.t,c);return;}
  const bit=1n<<BigInt((c.t-t)/60000),b=this.bins.get(t);if(!b){this.bins.set(t,{c:{...c,t,interval:this.interval},count:1,first:c.t,last:c.t,mask:bit});return;}if(b.mask&bit)return;b.mask|=bit;b.c.h=Math.max(b.c.h,c.h);b.c.l=Math.min(b.c.l,c.l);b.c.v+=c.v;b.c.closed&&=c.closed;b.c.complete&&=c.complete;b.count++;if(c.t<b.first){b.first=c.t;b.c.o=c.o;}if(c.t>b.last){b.last=c.t;b.c.c=c.c;}
 }
 result(){return [...this.bins].sort(([a],[b])=>a-b).map(([t,b])=>({...b.c,complete:b.c.complete&&b.count===this.interval/60000&&b.first===t&&b.last===t+this.interval-60000,closed:b.c.closed&&b.count===this.interval/60000})).concat([...this.tail.values()]);}
}
