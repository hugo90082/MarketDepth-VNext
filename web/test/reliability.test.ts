import {test} from 'node:test';
import assert from 'node:assert/strict';
import {zonesOf} from '../shared/exchanges';
import {BitfinexLiveBooks,KrakenLiveBook,CoinbaseLiveBook,crc32,parseKrakenMessage} from '../shared/live-books';
import {chartCandles,candleChange,visibleLogicalRange} from '../shared/chart-data';
import {ReconnectBackoff,retryAfterMs} from '../shared/retry';

test('a large full order book does not overflow the JavaScript argument stack',()=>{
 const bids=Array.from({length:200000},(_,i)=>[99.99-i/10000,1] as [number,number]);
 const asks=Array.from({length:200000},(_,i)=>[100.01+i/10000,1] as [number,number]);
 assert.ok(zonesOf({bids,asks})[0][0]!>0);
});
test('Bitfinex channel heartbeat keeps an unchanged verified book fresh, but not an invalid one',()=>{
 const books=new BitfinexLiveBooks();books.subscribe(1,'ETH','P1');books.subscribe(2,'ETH','P2');
 for(const id of [1,2])books.update([id,[[99,1,2],[90,1,1],[101,1,-3],[110,1,-1]]],1000);
 for(const id of [1,2])books.update([id,'hb'],50000);
 assert.equal(books.snapshot('ETH',50000).nearReady,true);
 assert.equal(books.snapshot('ETH',50000).broadReady,true);
 books.invalidate();books.update([1,'hb'],51000);
 assert.equal(books.snapshot('ETH',51000).nearReady,false);
});
test('Kraken numeric spelling survives JSON decoding for checksum validation',()=>{
 const raw='{"bids":[{"price":99.0,"qty":0.00000001}],"asks":[{"price":101.0,"qty":0.00100000}]}';
 const parsed=parseKrakenMessage(raw);
 parsed.checksum=crc32('10101000009901');
 const book=new KrakenLiveBook();book.update(parsed,'snapshot',1000);
 assert.equal(book.ready,true);
});
test('Coinbase full snapshot plus absolute updates/deletes and heartbeat preserve zones',()=>{
 const book=new CoinbaseLiveBook();assert.throws(()=>book.update({type:'l2update',changes:[]},100));
 book.update({type:'snapshot',bids:[['99.5','2'],['90','1']],asks:[['100.5','3'],['110','1']]},1000);
 book.update({type:'l2update',changes:[['buy','99.5','4']]},2000);assert.equal(book.snapshot(2000)[0][0],398);
 book.update({type:'l2update',changes:[['buy','99.5','0']]},3000);book.heartbeat(60000);assert.equal(book.snapshot(60000)[0][0],0);
 book.ready=false;book.heartbeat(70000);assert.equal(book.snapshot(70000)[0][0],null);
});
test('invalid/duplicate candle input cannot reach strict chart time assertions',()=>{
 const t=180000,bar={t,o:100,h:101,l:99,c:100,v:1,closed:false};
 assert.deepEqual(chartCandles([bar,{...bar,c:101},{...bar,t:120000},{...bar,t:240000,c:NaN}]).map(x=>[x.t,x.c]),[[120000,100],[180000,101]]);
 assert.equal(candleChange([bar],[{...bar,c:101}]),'last');
 assert.equal(candleChange([bar],[bar]),'none');
 assert.equal(candleChange([bar,{...bar,t:240000}],[{...bar,c:101},{...bar,t:240000}]),'all');
});
test('brief successful opens do not defeat reconnect backoff or Retry-After dates',()=>{
 const backoff=new ReconnectBackoff();for(const [i,expected]of [5000,10000,20000,40000,60000].entries()){backoff.opened(i*1000+1);assert.equal(backoff.delay(i*1000+100),expected);}
 backoff.opened(10000);assert.equal(backoff.delay(71000),5000);
 assert.equal(retryAfterMs('120',1000),120000);assert.equal(retryAfterMs(new Date(121000).toUTCString(),1000),120000);
});
test('production white-screen regression: an empty/replacing time axis is never resolved as a visible time range',()=>{
 assert.equal(visibleLogicalRange(0,60000,()=>null),null);
 assert.equal(visibleLogicalRange(NaN,60000,()=>0),null);
 assert.equal(visibleLogicalRange(60000,0,()=>0),null);
 assert.deepEqual(visibleLogicalRange(0,60000,t=>t/30),{from:0,to:2});
 assert.deepEqual(visibleLogicalRange(0,60000,()=>0),{from:0,to:1});
});
test('Kraken bounded top-ten selection matches a full depth sort after updates and trimming',()=>{
 const bids=Array.from({length:1000},(_,i)=>({price:(99.99-i/100).toFixed(2),qty:'0.00100000'}));
 const asks=Array.from({length:1000},(_,i)=>({price:(100.01+i/100).toFixed(2),qty:'0.00200000'}));
 const part=(s:string)=>s.replace('.','').replace(/^0+/,'')||'0';
 const checksum=(b:typeof bids,a:typeof asks)=>crc32([...a.slice(0,10),...b.slice(0,10)].map(l=>part(l.price)+part(l.qty)).join(''));
 const book=new KrakenLiveBook();book.update({bids,asks,checksum:checksum(bids,asks)},'snapshot',1000);
 const updated=bids.slice(1);updated.push({price:'80.00',qty:'0.00300000'});
 book.update({bids:[{price:bids[0].price,qty:'0.00000000'},{price:'80.00',qty:'0.00300000'},{price:'70.00',qty:'0.00400000'}],checksum:checksum(updated,asks)},'update',2000);
 assert.equal(book.ready,true);
});
