import {test} from 'node:test';import assert from 'node:assert/strict';
import {bridgeCoinbase,coinbaseRelay,relayCommand} from '../worker/coinbase-relay';
class Socket extends EventTarget{sent:string[]=[];closed:number[]=[];send(data:string){this.sent.push(data);}close(code=1000){this.closed.push(code);}accept(){}message(data:unknown){this.dispatchEvent(new MessageEvent('message',{data}));}}
test('relay accepts only bounded public USD level2/heartbeat commands',()=>{
 assert.deepEqual(relayCommand(JSON.stringify({type:'subscribe',product_ids:['BTC-USD','ETH-USD','SOL-USD'],channels:['level2_batch','heartbeat']})).product_ids,['BTC-USD','ETH-USD','SOL-USD']);
 for(const command of [{type:'subscribe',product_ids:['BTC-USD'],channels:['user']},{type:'subscribe',product_ids:['BTC-USD'],channels:['level2_batch'],key:'secret'},{type:'subscribe',product_ids:['BTC-USD/../../'],channels:['level2_batch']}])assert.throws(()=>relayCommand(JSON.stringify(command)));
 assert.throws(()=>relayCommand('x'.repeat(16385)));
});
test('relay preserves snapshot/update frames and releases both sides exactly once',()=>{
 const down=new Socket(),up=new Socket();let releases=0;const finish=bridgeCoinbase(down as any,up as any,()=>releases++);const subscribe=JSON.stringify({type:'subscribe',product_ids:['BTC-USD'],channels:['level2_batch']});down.message(subscribe);assert.equal(up.sent[0],subscribe);const snapshot='{"type":"snapshot","product_id":"BTC-USD","bids":[["100","2"]],"asks":[["101","3"]]}';up.message(snapshot);assert.equal(down.sent[0],snapshot);down.dispatchEvent(new Event('close'));up.dispatchEvent(new Event('error'));finish();assert.equal(releases,1);assert.deepEqual(up.closed,[1000]);assert.deepEqual(down.closed,[1000]);up.message(snapshot);assert.equal(down.sent.length,1);
});
test('relay rejects other origins and does not forward cookies or authorization upstream',async()=>{
 const url='https://site.test/api/coinbase-stream';assert.equal((await coinbaseRelay(new Request(url)))!.status,426);assert.equal((await coinbaseRelay(new Request(url,{headers:{Upgrade:'websocket',Origin:'https://other.test'}})))!.status,403);
 let headers:Headers|undefined;const up=new Socket(),client=new Socket(),server=new Socket();let finish:()=>void=()=>{};
 const response=await coinbaseRelay(new Request(url,{headers:{Upgrade:'websocket',Origin:'https://site.test',Cookie:'private',Authorization:'private'}}),{fetcher:async(input,init)=>{assert.equal(input,'https://ws-feed.exchange.coinbase.com');headers=new Headers(init?.headers);return {status:101,webSocket:up} as any;},pair:()=>({0:client,1:server}) as any,upgrade:()=>{finish=()=>server.dispatchEvent(new Event('close'));return new Response('upgraded');}});
 assert.equal(response!.status,200);assert.equal(headers!.get('Cookie'),null);assert.equal(headers!.get('Authorization'),null);finish();
});
