import { test } from 'node:test';
import assert from 'node:assert/strict';
import { depthRatioBuckets } from '../shared/chart-data';
import type { SpotRow } from '../shared/model';
import { emptyRow } from '../shared/contract';

const start = 1_800_000_000_000;
function sample(t: number, bid: number | null, ask: number | null): SpotRow {
 const row = emptyRow(t);
 row.d[0][0][0] = [bid, ask];
 return row;
}

test('depth ratio follows K-line period and weighs sampled USD depth before division', () => {
 const rows = [sample(start, 10, 0), sample(start + 30000, 0, 30)];
 assert.deepEqual(depthRatioBuckets(rows, 'BTC', 'binance', [0], 30000, start, start + 30000), [
  {t:start,value:1},{t:start+30000,value:-1},
 ]);
 assert.deepEqual(depthRatioBuckets(rows, 'BTC', 'binance', [0], 60000, start, start + 30000), [
  {t:start,value:-0.5},
 ]);
});

test('a missing or null sample leaves its whole candle period blank without interpolation', () => {
 const complete = Array.from({length:10},(_,i)=>sample(start+i*30000,20,10));
 assert.equal(depthRatioBuckets(complete,'BTC','binance',[0],300000,start,start+9*30000)[0].value,1/3);
 assert.equal(depthRatioBuckets(complete.slice(1),'BTC','binance',[0],300000,start,start+9*30000)[0].value,null);
 complete[4].d[0][0][0][0]=null;
 assert.equal(depthRatioBuckets(complete,'BTC','binance',[0],300000,start,start+9*30000)[0].value,null);
 assert.equal(depthRatioBuckets([sample(start,10,20)],'BTC','all4',[0],60000,start,start+30000)[0].value,null);
});

test('live unfinished period uses only elapsed 30-second samples', () => {
 assert.equal(depthRatioBuckets([sample(start,20,10)],'BTC','binance',[0],60000,start,start+10000)[0].value,1/3);
});
