import {test} from 'node:test';
import assert from 'node:assert/strict';
import {row} from './helpers';
import {CONTRACT,type StoredRow} from '../shared/contract';
import {completedProof} from '../src/history-verification';
import {HISTORY_BLOCK,recordBlocks,type ComparisonStatus,type VerifiedChunk} from '../src/history-quality';

test('batched verification matches complete proof for missing, null, revised and minute-converted rows',async()=>{
 const base=Math.floor(1790586900000/HISTORY_BLOCK)*HISTORY_BLOCK,to=base+20*HISTORY_BLOCK;
 const chunks=Array.from({length:20},(_,i)=>({id:'spot-'+(base+i*HISTORY_BLOCK),sha256:(i%2?'a':'b').repeat(64),startTsMs:base+i*HISTORY_BLOCK,endTsMs:base+(i+1)*HISTORY_BLOCK,cached:true}));
 const status:ComparisonStatus={ok:true,from:base,eligibleTo:to,indexVersion:4,indexed:{from:base,to},oldestAvailableTsMs:base,chunks,cacheComplete:true,lastCompleted:null};
 const rows:StoredRow[]=[],saved:VerifiedChunk[]=[];
 for(const [i,c] of chunks.entries()){
  const times=Array.from({length:30},(_,j)=>c.startTsMs+j*30000);saved.push({...c,rowTimes:times.filter((_,j)=>j!==6)});
  for(let j=0;j<15;j++){if(i===9&&j===4)continue;const r:StoredRow={...row(c.startTsMs+j*60000),source:'railway',format:CONTRACT.datasetFormat,cadence:60000};if(j===5)r.d[0][0][0][0]=null;rows.push(r);}
 }
 const confirmed=[{from:base+30000,to:to-60000}],old=recordBlocks([],status,[{from:base,to:base+30000}],saved,rows,1),expected=recordBlocks(old,status,confirmed,saved,rows,99),requests:number[]=[],progress:number[]=[];
 const actual=await completedProof(old,status,confirmed,saved,async(from,end)=>{requests.push(end-from+1);return rows.filter(r=>r.t>=from&&r.t<=end);},99,(n)=>progress.push(n));
 assert.deepEqual(actual,expected);assert.equal(requests.length,3);assert.ok(requests.every(n=>n<=8*HISTORY_BLOCK));assert.equal(progress.at(-1),20);
 const changed={...status,chunks:chunks.map((c,i)=>i===3?{...c,sha256:'c'.repeat(64)}:c)};
 assert.deepEqual(await completedProof(actual,changed,confirmed,saved,async(from,end)=>rows.filter(r=>r.t>=from&&r.t<=end),100),recordBlocks(actual,changed,confirmed,saved,rows,100));
});
