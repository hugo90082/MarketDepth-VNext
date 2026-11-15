import 'fake-indexeddb/auto';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as storage from '../src/storage';

test('an old collector cannot commit an asynchronous K-line reply after a newer term',async()=>{
 const t=Math.floor(Date.now()/60000)*60000,c={asset:'BTC' as const,interval:60000 as const,t,o:1,h:2,l:1,c:2,v:3,closed:true,complete:true};
 await storage.setMeta('collector-term',101);
 await storage.save([],[c],true,{term:101,current:()=>true});
 await storage.setMeta('collector-term',102);
 await assert.rejects(storage.save([],[{...c,c:1.5}],true,{term:101,current:()=>true}),/STALE_COLLECTOR_WRITE/);
 assert.equal((await storage.loadCandles('BTC',t,t))[0].c,2);
 await assert.rejects(storage.save([],[{...c,c:1.5}],true,{term:102,current:()=>false}),/STALE_COLLECTOR_WRITE/);
 let checks=0;await assert.rejects(storage.save([],[{...c,c:1.5}],true,{term:102,current:()=>++checks<2}),/STALE_COLLECTOR_WRITE/);
 assert.equal((await storage.loadCandles('BTC',t,t))[0].c,2);
 checks=0;await assert.rejects(storage.save([],[{...c,c:1.5}],true,{term:102,current:()=>++checks<3}),/STALE_COLLECTOR_WRITE/);
 assert.equal((await storage.loadCandles('BTC',t,t))[0].c,2);
 await storage.save([],[{...c,c:1.5}],true,{term:102,current:()=>true});
 assert.equal((await storage.loadCandles('BTC',t,t))[0].c,1.5);
});
