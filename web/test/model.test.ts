import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ageAt,depth,imbalance,mergeRows,validateRow,gridRows} from '../shared/model';
import {row} from './helpers';

test('available ALL4 and cumulative sum raw quantities before ratio',()=>{
  const r=row();r.d[0][0][0]=[1,9];r.d[1][0][0]=[900,100];
  const d=depth(r,'BTC','all4',[0]);assert.equal(d.bid,1101);assert.equal(d.ask,209);assert.equal(d.ratio,892/1310);
  const c=depth(r,'BTC','binance',[0,1]);assert.equal(c.bid,101);assert.equal(c.ask,59);assert.equal(c.ratio,42/160);
});
test('one missing side does not erase valid sides, zones or venues',()=>{
  const r=row();r.d[2][0][0]=[null,50];
  assert.deepEqual(depth(r,'BTC','all4',[0]),{bid:300,ask:150,ratio:1/3,fullVenues:3});
  assert.equal(depth(r,'BTC','binance',[0]).bid,100);
  assert.equal(depth(r,'BTC','all4',[1]).ratio,1/3);
  assert.equal(depth(r,'BTC','all4',[0,1]).bid,600);
});
test('historical Binance BTC null leaves other three sources available while other three venues remain individual data',()=>{
 const previous=row(),missing=row(previous.t+30_000);
 for(const zone of missing.d[0][0])zone[0]=zone[1]=null;
 const rows=mergeRows([previous],[missing]);
 assert.equal(rows[1],missing);
 for(const {row:point} of gridRows(rows,previous.t,missing.t)){
  if(point?.t===missing.t){assert.equal(depth(point,'BTC','all4',[0,1,2,3,4]).ratio,1/3);assert.equal(depth(point,'BTC','coinbase',[0,1,2,3,4]).ratio,1/3);}
 }
});
test('zero is valid quantity; null and zero denominator do not yield ratio',()=>{
  assert.equal(imbalance(0,100),-1);assert.equal(imbalance(100,0),1);
  assert.equal(imbalance(0,0),null);assert.equal(imbalance(null,10),null);
  const r=row();r.d[0][0][0]=[0,0];assert.doesNotThrow(()=>validateRow(r));
  r.d[0][0][0]=[-1,2];assert.throws(()=>validateRow(r));
});
test('historical wins duplicate target and gaps stay explicit',()=>{
  const a=row(),b=row(a.t+60_000),sealed=row();sealed.d[0][0][0]=[5,6];
  const merged=mergeRows([b,a],[sealed]);assert.equal(merged.length,2);assert.equal(merged[0].d[0][0][0][0],5);
  const grid=gridRows(merged,a.t,b.t);assert.equal(grid.length,3);assert.equal(grid[1].row,undefined);
});
test('data age continues during failures and does not decrease on local clock rollback',()=>{
  assert.equal(ageAt(10_000,1000,70_000),79_000);assert.equal(ageAt(10_000,1000,900),10_000);assert.equal(ageAt(null,null,100),null);
});
