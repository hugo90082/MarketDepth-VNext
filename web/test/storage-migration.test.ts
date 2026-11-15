import 'fake-indexeddb/auto';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {row} from './helpers';
import {CONTRACT,type StoredRow} from '../shared/contract';
import {minuteRows} from '../shared/minute-history';

Object.defineProperty(globalThis,'localStorage',{value:{removeItem(){}}});
const complete=(tx:IDBTransaction)=>new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});
test('v3 records migrate losslessly into compact blocks and survive repeated startup',async()=>{
 const db=await new Promise<IDBDatabase>((resolve,reject)=>{
  const request=indexedDB.open('marketdepth-cache',3);
  request.onupgradeneeded=()=>{const db=request.result;db.createObjectStore('rows',{keyPath:'t'});const c=db.createObjectStore('candles',{keyPath:['asset','interval','t']});c.createIndex('time','t');db.createObjectStore('meta');};
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
 });
 const t=row().t,rows:StoredRow[]=Array.from({length:30},(_,i)=>({...row(t+i*30000),source:'browser',format:CONTRACT.datasetFormat,captured:Array.from({length:4},()=>[true,true,true])}));
 rows[0].d[0][0][0]=[null,0];
 const legacyBytes=rows.reduce((n,r)=>n+new TextEncoder().encode(JSON.stringify(r)).byteLength+256,0);
 const tx=db.transaction(['rows','candles','meta'],'readwrite');for(const value of rows)tx.objectStore('rows').put(value);
 tx.objectStore('candles').put({asset:'BTC',interval:60000,t,o:1,h:2,l:1,c:2,v:3,closed:true,complete:true});
 tx.objectStore('meta').put(CONTRACT.datasetFormat,'format');tx.objectStore('meta').put(legacyBytes,'bytes');await complete(tx);db.close();
 const storage=await import('../src/storage');await storage.initStorage();
 assert.deepEqual(await storage.loadRows(t,t+29*30000),minuteRows(rows));
 assert.equal((await storage.loadCandles('BTC',t,t))[0]?.c,2);
 const encoded=await storage.getMeta<number>('bytes');assert.ok(encoded&&encoded<legacyBytes/2);
 await storage.initStorage();assert.deepEqual(await storage.loadRows(t,t+29*30000),minuteRows(rows));
 const migrated=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('marketdepth-cache',5);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 const old=await new Promise<unknown[]>((resolve,reject)=>{const r=migrated.transaction('rows').objectStore('rows').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 assert.equal(old.length,0);migrated.close();
});
