import {test} from 'node:test';
import assert from 'node:assert/strict';
import {zonesOf,SequencedBook,fillMissing,parseBook,endpoint,bitfinexPrecisions} from '../shared/exchanges';
import {BitfinexLiveBooks,KrakenLiveBook,crc32} from '../shared/live-books';
import {CONTRACT,aggregateCandles,barWidths,gaps,mergeRecentGap,type StoredRow,type StoredCandle} from '../shared/contract';
import {parseKlines} from '../shared/klines';
import {row} from './helpers';

test('Binance observed outer diff participates in zones until stale or sequence gap',()=>{
 const book=new SequencedBook();book.replace({lastUpdateId:10,bids:[[99.99,1],[99.5,1],[98.5,1]],asks:[[100.01,1],[100.5,1],[101.5,1]]},1000);
 book.diff({U:11,u:11,b:[[90,2]],a:[[110,2]]},2000);const z=book.snapshot(2000);
 assert.ok(z.every(pair=>pair.every(value=>value!==null)));
 assert.deepEqual(book.snapshot(48001),Array.from({length:5},()=>[null,null]));
 assert.throws(()=>book.diff({U:13,u:13,b:[],a:[]},3000));assert.equal(book.ready,false);
});
test('Kraken GroupedBook actual object shape, exact zero and live updates',()=>{
 const grouped=parseBook('kraken-grouped',{error:[],result:{pair:'XBTUSD',bids:[{price:'99',qty:'2'}],asks:[{price:'101',qty:'3'}],grouping:1000}});
 assert.deepEqual(grouped,{bids:[[99,2]],asks:[[101,3]]});
 assert.equal(crc32('123456789'),0xcbf43926);
 const live=new KrakenLiveBook();live.update({bids:[{price:'99.5',qty:'2'},{price:'90',qty:'1'}],asks:[{price:'100.5',qty:'3'},{price:'110',qty:'1'}]},'snapshot',1000);
 assert.equal(live.snapshot(1000)[0][0],199);live.update({bids:[{price:'99.5',qty:'0'}]},'update',2000);
 assert.equal(live.snapshot(2000)[0][0],0);assert.deepEqual(fillMissing([[0,null]],[[5,7]]),[[0,7]]);
 live.update({checksum:crc32('100531101901')},'update',2500);
 assert.throws(()=>live.update({checksum:123},'update',3000),/KRAKEN_CHECKSUM/);
 assert.equal(live.ready,false);
});
test('Bitfinex P1/P2 snapshot, update, delete and invalid checksum',()=>{
 assert.deepEqual(bitfinexPrecisions,['P1','P2']);
 assert.match(endpoint('bitfinex-near','BTC'),/\/P1\?len=250$/);
 assert.match(endpoint('bitfinex-broad','BTC'),/\/P2\?len=250$/);
 const live=new BitfinexLiveBooks();live.subscribe(1,'BTC','P1');live.subscribe(2,'BTC','P2');
 live.update([1,[[99.5,1,2],[100.5,1,-3],[90,1,1],[110,1,-1]]],1000);
 live.update([2,[[99.5,1,2],[100.5,1,-3],[90,1,1],[110,1,-1]]],1000);
 assert.equal(live.snapshot('BTC',1000).nearReady,true);
 live.update([1,'cs',crc32('99.5:2:100.5:-3:90:1:110:-1')|0],1001);
 live.update([1,[99.5,0,1]],2000);assert.equal(live.snapshot('BTC',2000).zones[0][0],0);
 assert.throws(()=>live.update([1,'cs',123],2001),/BITFINEX_CHECKSUM/);
 assert.equal(live.snapshot('BTC',2001).nearReady,false);
 assert.equal(live.snapshot('BTC',2001).zones[0][0],null,'P2 cannot replace a failed P1 near side');
 live.invalidate();assert.equal(live.snapshot('BTC',2001).broadReady,false);
});
test('USD sum uses per-level price, half-open boundaries, independent coverage, and real zero',()=>{
 const z=zonesOf({bids:[[100,2],[99,3],[92.5,1]],asks:[[100.00001,1],[107.50001,1]]});
 assert.equal(z[0][0],200);assert.equal(z[1][0],297);
 const zero=zonesOf({bids:[[99.99,1],[90,1]],asks:[[100.01,1],[110,1]]});assert.deepEqual(zero[1],[0,0]);
 const partial=zonesOf({bids:[[99.99,1],[98.5,1]],asks:[[100.01,1],[110,1]]});assert.equal(partial[1][0],null);assert.equal(partial[1][1],0);
 assert.deepEqual(fillMissing([[0,null]],[[100,20]]),[[0,20]]);
});
test('coverage nulls can be compared once; confirmed backend gaps do not repeat paid downloads',()=>{
 const r:StoredRow={...row(),source:'browser',format:CONTRACT.datasetFormat,captured:Array.from({length:4},()=>[true,true,true])};r.d[0][0][4]=[null,null];
 assert.equal(gaps([r],r.t,r.t+30000).length,1);r.captured![1][0]=false;assert.equal(gaps([r],r.t,r.t+30000).length,1);
 assert.deepEqual(gaps([r],r.t,r.t+30000,[{from:r.t,to:r.t+30000}]),[]);
 r.source='railway';assert.deepEqual(gaps([r],r.t,r.t+30000),[]);
});
test('paired bars are per venue, exact zero remains zero',()=>{assert.deepEqual(barWidths(50,50),[50,50]);assert.deepEqual(barWidths(0,100),[0,100]);assert.deepEqual(barWidths(0,0),[0,0]);assert.deepEqual(barWidths(null,100),[0,0]);});
test('unsealed Recent fills browser gaps without erasing a valid local side',()=>{
 const local:StoredRow={...row(),source:'browser',format:CONTRACT.datasetFormat};local.d[0][0][0]=[10,20];
 const retained=local.d[1][0][0][1];
 const remote=row();remote.d[0][0][0]=[null,30];remote.d[1][0][0]=[40,null];
 const merged=mergeRecentGap(local,remote);assert.deepEqual(merged.d[0][0][0],[10,30]);assert.deepEqual(merged.d[1][0][0],[40,retained]);assert.equal(merged.source,'recent');
 // A Recent response is provisional. Once this time range is sealed, the
 // historical comparison must still be scheduled even when Recent filled it.
 assert.deepEqual(gaps([merged],merged.t,merged.t+30000),[{from:merged.t,to:merged.t+30000}]);
});
test('1m candles validate and 5m aggregation exposes missing children; no invented 30s',()=>{
 const t=Math.floor(row().t/300000)*300000;
 const bars:StoredCandle[]=Array.from({length:5},(_,i)=>({asset:'BTC',interval:60000,t:t+i*60000,o:100,h:110,l:90,c:105,v:2,closed:true,complete:true}));
 assert.equal(aggregateCandles(bars,300000)[0].complete,true);assert.equal(aggregateCandles(bars.slice(1),300000)[0].complete,false);assert.deepEqual(aggregateCandles(bars,30000),[]);
 const raw=[[t,'100','110','90','105','2',t+59999,'0',1,'1','1','0']];assert.equal(parseKlines(raw,'BTC',t+1000)[0].closed,false);assert.equal(parseKlines(raw,'BTC',t+60000)[0].closed,true);
});
