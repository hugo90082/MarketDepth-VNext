import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRawBook,summarizeBook} from '../src/monitor/depth-engine/order-book';
import {researchBook} from '../shared/research-book';
import {createMarketSelectionClient} from '../src/monitor/market-selection-client';
import {createReservationQueue} from '../shared/reservation-queue';
import {readFile} from 'node:fs/promises';
import {depth} from '../shared/model';
import {emptyRow,type StoredRow,CONTRACT} from '../shared/contract';

test('sparse outer increments do not expand verified depth or invent empty outer research zones',()=>{
 const book=createRawBook({pair:'BTCUSDT',quote:'USDT',feed:'test',bids:[[99.9,1],[99,2],[50,3]],asks:[[100.1,1],[101,2],[150,3]],capturedAt:1000,lastMessageAt:950,verifiedBounds:{bid:99,ask:101}});
 const research=researchBook(book),monitor=summarizeBook('Binance',book,1000,()=>1000);
 assert.deepEqual(research.quality.complete,[true,false,false,false,false]);
 assert.deepEqual(research.zones[2],[null,null]);assert.equal(monitor.ranges['3'].status,'partial');
 assert.equal(monitor.ageMs,50);assert.equal(monitor.lastMessageAt,950);
});

test('continuous Diff exposes observed outer reach separately from snapshot-confirmed coverage',()=>{
 const book=createRawBook({pair:'BTCUSDT',quote:'USDT',feed:'test',bids:[[99.9,1],[99,2],[95,3]],asks:[[100.1,1],[101,2],[106,3]],capturedAt:1000,snapshotAt:800,verifiedBounds:{bid:99,ask:101},coverageMode:'sequenced-diff'});
 const result=researchBook(book);
 assert.equal(result.quality.observedBidBps,500);assert.equal(result.quality.observedAskBps,600);
 assert.equal(result.quality.bidBps,100);assert.equal(result.quality.askBps,100);
 assert.equal(result.quality.snapshotAt,800);assert.equal(result.quality.coverageMode,'sequenced-diff');
 assert.equal(result.quality.complete[4],false);assert.ok(result.zones[4][1]!>0,'actual outer increments remain usable');
});

test('new partial cumulative depth retains observed amounts without filling unknown zones or changing old history',()=>{
 const book=researchBook(createRawBook({pair:'BTCUSDT',quote:'USDT',feed:'test',bids:[[99.9,1],[99,2]],asks:[[100.1,1],[99.99+1,2]],capturedAt:30000,verifiedBounds:{bid:99,ask:101}}));
 const row:StoredRow={...emptyRow(30000),source:'browser',format:CONTRACT.datasetFormat,quality:{version:'FORMAL_AVAILABLE_V2',books:Array.from({length:4},()=>Array(3).fill(null))}};
 row.d[0][0]=book.zones;row.quality!.books[0][0]=book.quality;
 const partial=depth(row,'BTC','binance',[0,1,2]);
 assert.equal(partial.bid,297.9);assert.equal(partial.ask,302.08);assert.notEqual(partial.ratio,null);
 assert.deepEqual(depth(row,'BTC','binance',[2]),{bid:null,ask:null,ratio:null,fullVenues:0});
 assert.deepEqual(row.d[0][0][2],[null,null]);
 assert.equal(depth({...row,quality:undefined},'BTC','binance',[0,1,2]).ratio,null);
 assert.equal(depth({...row,quality:{...row.quality!,version:'FORMAL_AVAILABLE_V1'}},'BTC','binance',[0,1,2]).ratio,null);
 row.d[0][0][0][0]=null;assert.equal(depth(row,'BTC','binance',[0,1,2]).bid,null,'missing inner ranges remain unknown');
});

test('an authoritative missing market is cached while catalog failure stays retryable',async()=>{
 let calls=0;const select=createMarketSelectionClient(async()=>{calls++;return Response.json({symbol:'MISSING',selections:{Coinbase:{market:null},Kraken:{error:'catalog unavailable'}}});});
 assert.equal(await select('Coinbase','MISSING'),null);assert.equal(await select('Coinbase','MISSING'),null);assert.equal(calls,1);
 await assert.rejects(select('Kraken','MISSING'),/catalog unavailable/);await assert.rejects(select('Kraken','MISSING'),/catalog unavailable/);assert.equal(calls,3);
});

test('ordinary requests cannot occupy reserved core permits before a sampling window',async()=>{
 const start=Date.now(),state={nextAllowedAt:start,blockedUntil:0,priorityAt:start+15,priorityUntil:start+50};
 const reserve=createReservationQueue(state),order:string[]=[];
 const normal=reserve(100,0).then(()=>order.push('ordinary'));
 const core=reserve(1,1).then(()=>order.push('core'));
 await core;assert.deepEqual(order,['core']);await normal;assert.ok(Date.now()>=start+50);
});

test('research selectors stay inside their page, including mobile rules; both headers own navigation',async()=>{
 const css=await readFile('src/styles.css','utf8');const {default:postcss}=await import('postcss');
 postcss.parse(css).walkRules(rule=>{if(rule.parent?.type==='atrule'&&/keyframes$/.test(rule.parent.name))return;for(const selector of rule.selectors)assert.ok(selector.includes('.research-page'),selector);});
 const unified=await readFile('src/UnifiedApp.tsx','utf8');assert.ok(!unified.includes('<nav'));assert.match(unified,/navigation=\{navigation\}/);
 const monitor=await readFile('src/monitor/depth-monitor.tsx','utf8');assert.ok(!monitor.includes('SettingsTransfer'));assert.ok(monitor.includes('{navigation}'));
});
