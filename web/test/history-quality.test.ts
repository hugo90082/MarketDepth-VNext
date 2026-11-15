import {test} from 'node:test';
import assert from 'node:assert/strict';
import {row} from './helpers';
import {CONTRACT,type StoredRow} from '../shared/contract';
import {assessHistory,recordBlocks,statusAfterCompletedJob,type ComparisonStatus,type VerifiedChunk} from '../src/history-quality';

const base=1790586900000;
const status=(chunks:ComparisonStatus['chunks']=[]):ComparisonStatus=>({ok:true,from:base,eligibleTo:base+900000,indexVersion:4,indexed:{from:base,to:base+900000},oldestAvailableTsMs:base,chunks,cacheComplete:true,lastCompleted:null});
const stored=(t:number):StoredRow=>({...row(t),source:'railway',format:CONTRACT.datasetFormat});
test('backend null and absent rows are confirmed missing, not another comparison request',()=>{
 const remote=stored(base);remote.d[0][0][0][0]=null;
 const chunk={id:'spot-'+base,sha256:'a'.repeat(64),startTsMs:base,endTsMs:base+900000,cached:true};
 const proof:VerifiedChunk={...chunk,rowTimes:[base]};
 const blocks=recordBlocks([],status([chunk]),[{from:base,to:base+60000}],[proof],[remote],base+900000);
 const quality=assessHistory([remote],base,base+60000,'BTC','all4',[0],status([chunk]),blocks);
 assert.equal(quality.unverified,0);assert.equal(quality.backendNull,1);assert.equal(quality.backendAbsent,1);
 assert.equal(quality.available,1);assert.equal(quality.backendValid,1);assert.equal(quality.unknownCoverage,1);
});
test('evicted verified rows are local loss and changed chunk SHA requires a new comparison',()=>{
 const remote=stored(base),chunk={id:'spot-'+base,sha256:'a'.repeat(64),startTsMs:base,endTsMs:base+900000,cached:true};
 const blocks=recordBlocks([],status([chunk]),[{from:base,to:base+30000}],[{...chunk,rowTimes:[base]}],[remote],base+900000);
 assert.equal(assessHistory([],base,base+30000,'BTC','all4',[0],status([chunk]),blocks).localLost,1);
 assert.equal(assessHistory([remote],base,base+30000,'BTC','all4',[0],status([{...chunk,sha256:'b'.repeat(64)}]),blocks).unverified,1);
});
test('recent unsealed slots are separate from sealed unverified slots',()=>{
 const q=assessHistory([],base,base+900000+30000,'BTC','all4',[0],status(),[]);
 assert.equal(q.unverified,30);assert.equal(q.unsealed,1);assert.equal(q.expected,31);
});
test('completion of an old job does not treat newer sealed hours as unsealed',()=>{
 const old=status(),now=base+6*3600000+900000;
 const current=statusAfterCompletedJob(old,now,7);
 assert.ok(current.eligibleTo>old.eligibleTo);
 assert.equal(current.cacheComplete,false);
 const q=assessHistory([],base,now,'BTC','all4',[0],current,[]);
 assert.ok(q.unverified>30,'newly sealed hours must remain eligible for comparison');
 assert.ok(q.unsealed<=60,'only recent history can be called unsealed');
});
