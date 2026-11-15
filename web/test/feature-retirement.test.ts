import {test} from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {retireLocalDatabases} from '../src/feature-retirement';
import {cleanupRetiredUpload} from '../work/extension-v1.4.2/src/lib/retired-upload.js';
import worker from '../worker/index';
import {database,environment} from './helpers';
import {initialize} from '../worker/db';
const open=(factory:IDBFactory,name:string)=>new Promise<IDBDatabase>((resolve,reject)=>{const r=factory.open(name,1);r.onupgradeneeded=()=>r.result.createObjectStore('records');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
test('resumable retirement deletes only named databases and retains ordinary history',async()=>{
 const factory=new IDBFactory();for(const name of ['marketdepth-liquidations','marketdepth-shared','marketdepth-backup-imports','marketdepth-cache','other-project']){const db=await open(factory,name);db.close();}
 await retireLocalDatabases(factory);assert.deepEqual((await factory.databases()).map(d=>d.name).sort(),['marketdepth-cache','other-project']);await retireLocalDatabases(factory);
 const held=await open(factory,'marketdepth-shared');await assert.rejects(retireLocalDatabases(factory),/舊版/);assert.ok((await factory.databases()).some(d=>d.name==='marketdepth-shared'));held.close();await new Promise(r=>setTimeout(r,20));await retireLocalDatabases(factory);assert.ok(!(await factory.databases()).some(d=>d.name==='marketdepth-shared'));
});
test('plugin downgrade clears only obsolete upload storage and alarm',async()=>{
 const factory=new IDBFactory();for(const name of ['marketdepth-extension-upload','alert-rules']){const db=await open(factory,name);db.close();}const calls:string[]=[];
 await cleanupRetiredUpload(factory,{clear:async(name:string)=>{calls.push(name);return true;}});assert.deepEqual(calls,['marketdepth-shared-upload']);assert.deepEqual((await factory.databases()).map(d=>d.name),['alert-rules']);
});
test('D1 retirement removes shared tables and credentials but preserves Railway cache and auth',()=>{
 const raw=new DatabaseSync(':memory:');for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')&&!f.startsWith('0003')).sort())raw.exec(readFileSync('drizzle/'+file,'utf8'));
 raw.exec("INSERT INTO md_chunks VALUES('kept','hash',0,'[]'); INSERT INTO md_snapshots VALUES('v3-collector','{}',0),('v3-auth-rate:kept','{}',0),('shared-version','99',0); INSERT INTO md_gate VALUES('collector','kept',1,1),('shared-upload:gone','token',1,1); INSERT INTO md_qualification VALUES('gone','session','collector',1,'challenge','{}','hash',0,0)");
 raw.exec(readFileSync('drizzle/0003_heavy_spencer_smythe.sql','utf8'));assert.equal(raw.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name IN ('md_shared_records','md_shared_versions','md_shared_conflicts','md_qualification')").get()!.count,0);
 assert.equal(raw.prepare('SELECT COUNT(*) AS count FROM md_chunks').get()!.count,1);assert.equal(raw.prepare("SELECT COUNT(*) AS count FROM md_snapshots WHERE key LIKE 'v3-%'").get()!.count,2);assert.equal(raw.prepare('SELECT owner FROM md_gate').get()!.owner,'kept');raw.close();
});
test('all retired shared routes reject anonymous and old bearer calls without upstream work',async()=>{
 const {db}=database(),env=environment(db);for(const path of ['status','history','qualification/start','upload','executor','backfill/claim']){const r=await worker.fetch(new Request('https://site.test/api/shared/'+path,{method:path==='status'||path==='history'?'GET':'POST',headers:{authorization:'Bearer old-retired-credential'}}),env,{} as ExecutionContext);assert.equal(r.status,410);assert.equal((await r.json() as any).error.code,'FEATURE_RETIRED');}
});
test('startup cleanup removes late retired metadata writes while retaining native jobs',async()=>{
 const {db}=database();
 await db.prepare("INSERT INTO md_snapshots VALUES('shared-archive-cursor','{}',0),('v3-collector','{}',0)").run();
 await db.prepare("INSERT INTO md_gate VALUES('shared-executor:late','retired',0,0),('collector','kept',0,0)").run();
 await initialize(db);await initialize(db);
 assert.equal(await db.prepare("SELECT key FROM md_snapshots WHERE key LIKE 'shared-%'").first(),null);
 assert.equal(await db.prepare("SELECT key FROM md_gate WHERE key LIKE 'shared-%'").first(),null);
 assert.ok(await db.prepare("SELECT key FROM md_snapshots WHERE key='v3-collector'").first());
 assert.ok(await db.prepare("SELECT key FROM md_gate WHERE key='collector'").first());
});
