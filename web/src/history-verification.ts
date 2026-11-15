import type {StoredRow,Span} from '../shared/contract';
import {HISTORY_BLOCK,recordBlocks,type ComparisonStatus,type VerifiedBlock,type VerifiedChunk} from './history-quality';
/** Verify long ranges in two-hour batches; keep raw minute rows out of a whole-range array. */
export async function completedProof(previous:VerifiedBlock[],status:ComparisonStatus,confirmed:Span[],chunks:VerifiedChunk[],load:(from:number,to:number)=>Promise<StoredRow[]>,at:number,progress?:(done:number,total:number)=>void){
 if(!status.indexed)return previous;const output=new Map(previous.map(b=>[b.base,b])),bases=new Set<number>();
 for(const span of confirmed){const from=Math.max(span.from,status.indexed.from),to=Math.min(span.to,status.indexed.to);for(let b=Math.floor(from/HISTORY_BLOCK)*HISTORY_BLOCK;b<to;b+=HISTORY_BLOCK)if(b+HISTORY_BLOCK>from)bases.add(b);}
 const ordered=[...bases].sort((a,b)=>a-b),byBase=new Map<number,typeof status.chunks>(),known=new Map(chunks.map(c=>[c.id+':'+c.sha256,c]));
 for(const c of status.chunks)for(let b=Math.floor(c.startTsMs/HISTORY_BLOCK)*HISTORY_BLOCK;b<c.endTsMs;b+=HISTORY_BLOCK)if(bases.has(b)){const list=byBase.get(b)??[];list.push(c);byBase.set(b,list);}
 let i=0;while(i<ordered.length){const start=ordered[i],end=start+8*HISTORY_BLOCK,batch:number[]=[];while(i<ordered.length&&ordered[i]<end)batch.push(ordered[i++]);
  const indexed=[...new Map(batch.flatMap(b=>byBase.get(b)??[]).map(c=>[c.id+':'+c.sha256,c])).values()],saved=indexed.flatMap(c=>{const v=known.get(c.id+':'+c.sha256);return v?[v]:[];}),rows=await load(start,end-1),spans=confirmed.map(s=>({from:Math.max(start,s.from),to:Math.min(end,s.to)})).filter(s=>s.from<s.to);
  const result=recordBlocks(batch.flatMap(b=>{const v=output.get(b);return v?[v]:[];}),{...status,chunks:indexed},spans,saved,rows,at);for(const b of result)output.set(b.base,b);progress?.(i,ordered.length);
 }
 return [...output.values()].sort((a,b)=>a.base-b.base);
}
