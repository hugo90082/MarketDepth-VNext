import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSession,sessionCookie} from '../worker/auth';
import {marketHistoryApi,archiveMarketRailway} from '../worker/market-history';
import {database,environment,row} from './helpers';
import {CONTRACT,type StoredRow} from '../shared/contract';
import {emptyMarketBlock,marketContent,mergeMarketContent,marketHash,railwayReadbackHash} from '../shared/market-history';
import {sourceCode,offerOutcome} from '../shared/market-sync';
const base=1740000000000-1740000000000%900000;
const sample=(n=100):StoredRow=>({...row(base),source:'browser',format:CONTRACT.datasetFormat,cadence:60000,d:row(base).d.map(v=>v.map(a=>a.map(()=>[n,n/2])))});
const candle={asset:'BTC' as const,interval:60000 as const,t:base,o:100,h:110,l:90,c:105,v:7,closed:true,complete:true,source:'binance-usdm' as const};
test('market format whitelists only minute market data and rejects duplicate/open candles',()=>{
 const content=marketContent({...emptyMarketBlock(base),rows:[{...sample(),password:'private',settings:{}}],candles:[{...candle,token:'private'}],rules:['private']});
 assert.ok(!JSON.stringify(content).includes('private'));assert.equal(content.rows[0].cadence,60000);
 assert.throws(()=>marketContent({...content,candles:[{...candle,closed:false}]}));assert.throws(()=>marketContent({...content,rows:[sample(),sample()]}));
});
test('provisional merge is independent of arrival order and never adds amounts',async()=>{
 const a=marketContent({...emptyMarketBlock(base),rows:[sample(100)]}),b=marketContent({...emptyMarketBlock(base),rows:[sample(200)]});
 const ab=await mergeMarketContent(a,b),ba=await mergeMarketContent(b,a);
 assert.equal(await marketHash(ab.content),await marketHash(ba.content));assert.ok([100,200].includes(ab.content.rows[0].d[0][0][0][0]!));
});
test('only server Railway archives can create final rows including null and older versions cannot replace',async()=>{
 const old=marketContent({...emptyMarketBlock(base),rows:[sample()]}),final={...sample(),source:'railway' as const,finalVersion:8};final.d[0][0][0]=[null,null];
 const trusted=await mergeMarketContent(old,marketContent({...emptyMarketBlock(base),rows:[final]}),true);assert.deepEqual(trusted.content.rows[0].d[0][0][0],[null,null]);
 const fake=await mergeMarketContent(old,marketContent({...emptyMarketBlock(base),rows:[final]}));assert.equal(fake.content.rows[0].source,'browser');assert.equal(fake.content.rows[0].finalVersion,undefined);
 const stale=await mergeMarketContent(trusted.content,marketContent({...emptyMarketBlock(base),rows:[{...sample(),source:'railway',finalVersion:7}]}),true);assert.equal(stale.content.rows[0].finalVersion,8);
});
test('same quality conflicting candles preserve canonical data and report the exact minute',async()=>{
 const old=marketContent({...emptyMarketBlock(base),candles:[candle]}),next=marketContent({...emptyMarketBlock(base),candles:[{...candle,c:101}]});
 const result=await mergeMarketContent(old,next);assert.equal(result.content.candles[0].c,105);assert.deepEqual(result.conflicts,['BTC:'+base]);
});
async function fixture(){
 const {db,raw}=database(),env=environment(db),client=crypto.randomUUID(),job=crypto.randomUUID(),now=Date.now();
 const session=await createSession(env,now),cookie=sessionCookie(new Request('https://site.test'),session).split(';')[0]+'; md_client='+client;
 const req=(path:string,body?:unknown)=>new Request('https://site.test/api/market-history/'+path,{method:body?'POST':'GET',headers:{cookie,origin:'https://site.test',...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const rows=[{...sample(),source:'railway' as const}];
 raw.prepare('INSERT INTO md_jobs VALUES(?,?,?,?,?,?)').run(job,client,base,base+900000,now-1000,now);
 raw.prepare('INSERT INTO md_chunks VALUES(?,?,?,?)').run('chunk','a'.repeat(64),base,JSON.stringify(rows));
 raw.prepare('INSERT INTO md_snapshots VALUES(?,?,?)').run('v3-collector',JSON.stringify({verified:true,unauthorized:false,indexVersion:7,index:[{id:'chunk',sha256:'a'.repeat(64),startTsMs:base,endTsMs:base+900000}]}),now);
 const authorize=async()=>{const first=await marketHistoryApi(req('qualification',{phase:'begin',jobId:job}),env);assert.equal(first!.status,200);const challenge=await first!.json() as any;assert.equal(challenge.digest,undefined);const done=await marketHistoryApi(req('qualification',{phase:'confirm',nonce:challenge.nonce,digest:await railwayReadbackHash(rows)}),env);assert.equal(done!.status,200);return challenge;};
 return {db,raw,env,client,job,req,authorize,rows};
}
test('login alone/public hash do not qualify; real cached comparison and readback qualify without upstream',async()=>{
 const f=await fixture(),body={batchId:crypto.randomUUID(),blocks:[marketContent({...emptyMarketBlock(base),rows:[sample()],candles:[candle]})]};
 assert.equal((await marketHistoryApi(f.req('upload',body),f.env))!.status,403);
 assert.equal((await marketHistoryApi(f.req('qualification',{phase:'confirm',nonce:'public',digest:await railwayReadbackHash(f.rows)}),f.env))!.status,403);
 await f.authorize();const response=await marketHistoryApi(f.req('upload',body),f.env);assert.equal(response!.status,200);
 const saved=await response!.json() as any;assert.equal(saved.accepted[0].offeredHash,await marketHash(body.blocks[0]));
 const retry=await marketHistoryApi(f.req('upload',body),f.env);assert.deepEqual(await retry!.json(),saved);
 assert.equal((await marketHistoryApi(f.req('upload',{...body,batchId:crypto.randomUUID()}),f.env))!.status,429);
 const block=saved.accepted[0].block,publicRead=await marketHistoryApi(new Request('https://site.test/api/market-history/blocks/'+base+'?version='+block.version),f.env);
 assert.equal(publicRead!.status,200);assert.equal((await publicRead!.json() as any).block.sha256,block.sha256);assert.ok(!JSON.stringify(block).includes(f.client));
 f.raw.prepare('UPDATE md_market_collectors SET expires_at=0').run();assert.equal((await marketHistoryApi(f.req('upload',{...body,batchId:crypto.randomUUID()}),f.env))!.status,403);
});
test('late old-time Railway correction appears in version cursor and exact-version reads reject stale hashes',async()=>{
 const f=await fixture();await archiveMarketRailway(f.env,[sample()],1);
 const first=await marketHistoryApi(f.req('index?from='+base+'&to='+(base+900000)),f.env),a=await first!.json() as any;
 const revised={...sample(),source:'railway' as const};revised.d[0][0][0]=[null,null];await archiveMarketRailway(f.env,[revised],2);
 const second=await marketHistoryApi(f.req('index?from='+base+'&to='+(base+900000)+'&since='+a.cursor),f.env),b=await second!.json() as any;assert.equal(b.items.length,1);assert.ok(b.cursor>a.cursor);
 assert.equal((await marketHistoryApi(f.req('blocks/'+base+'?version='+a.items[0].version),f.env))!.status,409);
 const current=await marketHistoryApi(f.req('blocks/'+base+'?version='+b.items[0].version),f.env);assert.deepEqual((await current!.json() as any).block.rows[0].d[0][0][0],[null,null]);
});
test('wire/decompression limits reject oversized requests without accepting records',async()=>{
 const f=await fixture();await f.authorize();
 const response=await marketHistoryApi(f.req('upload',{padding:'x'.repeat(270000)}),f.env);assert.equal(response!.status,413);
 const stream=new Blob([JSON.stringify({padding:'x'.repeat(1100000)})]).stream().pipeThrough(new CompressionStream('gzip'));
 const request=new Request('https://site.test/api/market-history/upload',{method:'POST',headers:{cookie:f.req('status').headers.get('cookie')!,origin:'https://site.test','content-type':'application/json','content-encoding':'gzip'},body:await new Response(stream).arrayBuffer()});
 assert.equal((await marketHistoryApi(request,f.env))!.status,413);assert.equal(f.raw.prepare('SELECT COUNT(*) AS n FROM md_market_blocks').get()!.n,0);
});

test('source identity is stable, non-secret and cannot be assigned through a public API',async()=>{
 const f=await fixture(),a=await marketHistoryApi(f.req('source'),f.env),source=(await a!.json() as any).source;
 assert.equal(source.code,await sourceCode(f.client));assert.equal(source.configured,false);assert.equal(source.canUpload,true);assert.ok(!JSON.stringify(source).includes(f.client));
 assert.equal((await marketHistoryApi(f.req('source',{primary:source.code}),f.env))!.status,405);
 const fresh=await marketHistoryApi(new Request('https://site.test/api/market-history/source'),f.env);assert.match(fresh!.headers.get('set-cookie')!,/md_client=.*HttpOnly; Secure/);
});
test('the server denies previously qualified non-primary clients while public downloads remain available',async()=>{
 const f=await fixture();await f.authorize();const expires=f.raw.prepare('SELECT expires_at FROM md_market_collectors').get()!.expires_at;
 const content=marketContent({...emptyMarketBlock(base),rows:[sample()]});
 f.env.MARKET_HISTORY_PRIMARY_SOURCE=await sourceCode(crypto.randomUUID());
 assert.equal((await marketHistoryApi(f.req('upload',{batchId:crypto.randomUUID(),blocks:[content]}),f.env))!.status,403);
 assert.equal((await marketHistoryApi(f.req('qualification',{phase:'begin',jobId:f.job}),f.env))!.status,403);
 const status=await (await marketHistoryApi(f.req('status'),f.env))!.json() as any;assert.equal(status.eligible,false);assert.equal(status.source.canUpload,false);
 assert.equal((await marketHistoryApi(new Request(`https://site.test/api/market-history/index?from=${base}&to=${base+900000}`),f.env))!.status,200);
 f.env.MARKET_HISTORY_PRIMARY_SOURCE=await sourceCode(f.client);assert.equal((await marketHistoryApi(f.req('upload',{batchId:crypto.randomUUID(),blocks:[content]}),f.env))!.status,200);
 assert.equal(f.raw.prepare('SELECT expires_at FROM md_market_collectors').get()!.expires_at,expires);
 f.raw.prepare('UPDATE md_market_collectors SET expires_at=0').run();assert.equal((await marketHistoryApi(f.req('upload',{batchId:crypto.randomUUID(),blocks:[content]}),f.env))!.status,403);
 f.env.MARKET_HISTORY_PRIMARY_SOURCE='typo';assert.equal((await (await marketHistoryApi(f.req('source'),f.env))!.json() as any).source.canUpload,false);
});
test('receipts distinguish saved values from uncertified provenance, supersession and genuine conflicts',async()=>{
 const offered=marketContent({...emptyMarketBlock(base),rows:[{...sample(),source:'railway',finalVersion:7}]});
 const remote=(await mergeMarketContent(undefined,offered)).content;assert.equal(offerOutcome(offered,remote,[]),'values-saved');assert.equal(remote.rows[0].finalVersion,undefined);
 assert.equal(offerOutcome(remote,remote,[]),'saved');const better=marketContent({...emptyMarketBlock(base),rows:[sample(200)]});assert.equal(offerOutcome(remote,better,[]),'superseded');assert.equal(offerOutcome(remote,remote,['BTC:'+base]),'conflict');
});

test('public index distinguishes actual per-asset complete candles from depth-only history',async()=>{
 const f=await fixture();await archiveMarketRailway(f.env,[sample()],1);
 const other=marketContent({...emptyMarketBlock(base+900000),candles:[{...candle,t:base+900000},{...candle,asset:'SOL',t:base+1320000},{...candle,asset:'ETH',t:base+900000,complete:false}]});
 f.raw.prepare('INSERT INTO md_market_blocks(base,version,sha,body,updated_at) VALUES(?,?,?,?,?)').run(other.base,999,await marketHash(other),JSON.stringify(other),Date.now());
 const response=await marketHistoryApi(f.req(`index?from=${base}&to=${base+1800000}`),f.env),data=await response!.json() as any;
 assert.deepEqual(data.items.find((i:any)=>i.base===base).candleMasks,[0,0,0]);
 assert.deepEqual(data.items.find((i:any)=>i.base===other.base).candleMasks,[1,0,128]);
 f.raw.close();
});
