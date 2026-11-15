import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ViewportClock,moveViewport} from '../src/profile/viewport-clock';

test('display clock aligns to period boundaries and does not replay disabled or repeated slots',()=>{
 const clock=new ViewportClock();assert.equal(clock.tick(600001,300000,true),0);assert.equal(clock.tick(899999,300000,true),0);assert.equal(clock.tick(900000,300000,true),1);
 assert.equal(clock.tick(900000,300000,true),0);assert.equal(clock.tick(1800000,300000,true),3);
 assert.equal(clock.tick(2100000,300000,false),0);assert.equal(clock.tick(3300000,300000,true),0);assert.equal(clock.tick(3600000,300000,true),1);
 assert.equal(clock.tick(3300000,300000,true),0);assert.equal(clock.tick(3600000,300000,true),0,'clock correction cannot double-advance');
 assert.equal(clock.tick(3600000,3600000,true),0,'new interval starts a fresh clock');assert.equal(clock.tick(7200000,3600000,true),1);
});
test('backfill and rolling eviction preserve UTC location without changing zoom',()=>{
 const range={from:10.25,to:20.75};assert.deepEqual(moveViewport(range,600000,660000,60000,1),range);
 assert.deepEqual(moveViewport(range,600000,660000,60000,0),{from:9.25,to:19.75});
 assert.deepEqual(moveViewport(range,600000,300000,60000,1),{from:16.25,to:26.75});
});
