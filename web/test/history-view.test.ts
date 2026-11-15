import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DepthViewAccumulator,CandleViewAccumulator} from '../shared/history-view';
import {depthRatioBuckets} from '../shared/chart-data';
import {emptyRow,CONTRACT,type StoredRow} from '../shared/contract';
const start=1800000000000;
const sample=(t:number,bid:number,ask:number):StoredRow=>{const r={...emptyRow(t),cadence:60000 as const,source:'browser' as const,format:CONTRACT.datasetFormat};r.d[0][0][0]=[bid,ask];return r;};
test('streamed view preserves weighted amounts, mandatory gaps and available ALL4 across changing sources',()=>{
 const a=sample(start,10,0),b=sample(start+60000,0,30),c=sample(start+120000,10,10);c.d[0][0][0]=[null,null];c.d[1][0][0]=[10,10];
 const native=[a,b,c],acc=new DepthViewAccumulator(300000,start,start+120000,{venue:'all4',assets:['BTC'],zones:[[0]]});native.forEach(r=>acc.add(r));
 assert.deepEqual(depthRatioBuckets(acc.result(),'BTC','all4',[0],300000,start,start+120000),depthRatioBuckets(native,'BTC','all4',[0],300000,start,start+120000));
 const missing=new DepthViewAccumulator(300000,start,start+120000,{venue:'all4',assets:['BTC'],zones:[[0]]});[a,c].forEach(r=>missing.add(r));assert.equal(depthRatioBuckets(missing.result(),'BTC','all4',[0],300000,start,start+120000)[0].value,null);
});
test('minute view has only requested summaries and never copies the entire depth history matrix',()=>{
 const acc=new DepthViewAccumulator(60000,start,start+60000,{venue:'binance',assets:['BTC'],zones:[[0],[0,1]]});acc.add(sample(start,1,2));acc.add(sample(start+60000,2,3));const rows=acc.result();assert.equal(rows[0].d,rows[1].d);assert.equal(rows[0].bucket?.values[4],undefined);assert.equal(rows.at(-1)?.bucket,undefined);assert.equal(rows.at(-1)?.t,start+60000);
});
test('streamed candle aggregation prevents duplicate imported minutes and keeps a live minute tail',()=>{
 const acc=new CandleViewAccumulator('BTC',300000,start,start+300000),input=Array.from({length:5},(_,i)=>({asset:'BTC' as const,interval:60000 as const,t:start+i*60000,o:10+i,h:12+i,l:9+i,c:11+i,v:2,closed:true,complete:true}));for(const c of input){acc.add(c);acc.add(c);}acc.add({...input[0],t:start+300000,closed:false});const rows=acc.result();assert.equal(rows[0].v,10);assert.equal(rows[0].complete,true);assert.equal(rows[0].interval,300000);assert.equal(rows[1].interval,60000);
});
