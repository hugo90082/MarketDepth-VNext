import {test} from 'node:test';import assert from 'node:assert/strict';
import {packHave,unpackHave,HaveError} from '../shared/backfill-ack';
import {resolveHave} from '../worker/backfill-ack';import {database,environment} from './helpers';import {saveSnapshot} from '../worker/db';
test('six months of exact held chunk hashes fit a small acknowledgement and preserve holes',async()=>{
 const keys=Array.from({length:17280},(_,i)=>`spot-${i*900000}:${i.toString(16).padStart(64,'0')}`),held=new Set(keys.filter((_,i)=>i%3!==0));const data=await packHave(keys,held,0,180*86400000);assert.ok('haveCompact' in data);if(!('haveCompact' in data))return;assert.ok(JSON.stringify(data).length<5000);const restored=await unpackHave(data.haveCompact,[...keys].reverse());assert.deepEqual([...restored].sort(),[...held].sort());
 await assert.rejects(unpackHave(data.haveCompact,keys.slice(1)),(e:unknown)=>e instanceof HaveError&&e.code==='ACK_INDEX_CHANGED');await assert.rejects(unpackHave({...data.haveCompact,bits:''},keys));await assert.rejects(unpackHave({...data.haveCompact,to:data.haveCompact.to+1},keys));
});
test('compact acknowledgements bind the current Sites chunk version and do not acknowledge revised data',async()=>{
 const {db,raw}=database(),env=environment(db),to=Math.floor((Date.now()-900000)/900000)*900000,from=to-1344*900000;env.HISTORY_READ_TOKEN='';
 const index=Array.from({length:1344},(_,i)=>({id:'spot-'+(from+i*900000),sha256:'a'.repeat(64),startTsMs:from+i*900000,endTsMs:from+(i+1)*900000}));
 const insert=raw.prepare('INSERT INTO md_chunks VALUES(?,?,?,?)');for(const c of index)insert.run(c.id,c.sha256,c.startTsMs,'[]');await saveSnapshot(db,'v3-collector',{index,indexed:{from,to},indexVersion:1,oldest:from,connection:{state:'ok'}},Date.now());
 const keys=index.map(c=>c.id+':'+c.sha256),body=await packHave(keys,new Set(keys),from,to);assert.equal((await resolveHave(env,body))?.size,1344);
 index[0].sha256='b'.repeat(64);raw.prepare('UPDATE md_chunks SET sha=? WHERE id=?').run(index[0].sha256,index[0].id);await saveSnapshot(db,'v3-collector',{index,indexed:{from,to},indexVersion:2,oldest:from,connection:{state:'ok'}},Date.now());
 await assert.rejects(resolveHave(env,body),(e:unknown)=>e instanceof HaveError&&e.code==='ACK_INDEX_CHANGED');
});
