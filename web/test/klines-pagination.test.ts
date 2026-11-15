import assert from 'node:assert/strict';
import test from 'node:test';
import { nextKlineRequest } from '../shared/klines';
import { priceWindowChange } from '../shared/chart-data';

const MINUTE = 60_000;

test('seven-day futures history reaches the earliest gap despite a newest-first 1500-candle response', () => {
  const from = 1_790_000_000_000 - (1_790_000_000_000 % MINUTE);
  const end = from + 7 * 24 * 60 * MINUTE;
  const known = new Set<number>();
  for (let t = end - 2 * 24 * 60 * MINUTE; t < end; t += MINUTE) known.add(t);

  let calls = 0;
  while (known.size < 7 * 24 * 60) {
    const request = nextKlineRequest(from, end, known, false);
    assert.ok(request, 'an earlier gap must remain fetchable');
    assert.ok(request.endTime - request.startTime < 1500 * MINUTE);
    assert.ok(request.limit <= 1500);
    // Simulate the exchange choosing the newest `limit` candles in this window.
    const firstReturned = Math.max(request.startTime, request.endTime - 59_999 - (request.limit - 1) * MINUTE);
    for (let t = firstReturned; t <= request.endTime - 59_999; t += MINUTE) known.add(t);
    assert.ok(++calls < 10, 'the same recent candles must not be requested indefinitely');
  }
  assert.equal(nextKlineRequest(from, end, known, false), null);
});

test('stale live price gets a one-candle request before long history backfill', () => {
  const end = 1_790_100_000_000 - (1_790_100_000_000 % MINUTE);
  const request = nextKlineRequest(end - 7 * 24 * 60 * MINUTE, end, new Set(), true);
  assert.deepEqual(request, { startTime: end, endTime: end + MINUTE - 1, limit: 1 });
});

test('a seven-day price change stays unavailable while the chart starts only two days ago', () => {
  const from = 1_790_000_000_000 - (1_790_000_000_000 % MINUTE);
  const candle = (t:number,price:number) => ({t,o:price,h:price,l:price,c:price,v:1,closed:true});
  const partial=[candle(from+5*24*60*MINUTE,100),candle(from+7*24*60*MINUTE,90)];
  assert.equal(priceWindowChange(partial,from,MINUTE),null);
  assert.equal(priceWindowChange([candle(from,100),...partial],from,MINUTE),-0.1);
});
