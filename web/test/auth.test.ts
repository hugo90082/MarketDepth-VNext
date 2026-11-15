import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authBoundary, requireRailwaySession, RailwayAuthRequired, createSession, passwordDigest, SESSION_MS, sessionCookie, verifySession } from '../worker/auth';
import worker from '../worker/index';
import { siteFetch } from '../src/site-api';
import { database, environment, testPassword, authorizedRequest } from './helpers';

const origin='https://site.test';
const clock=1_790_350_200_000;
function login(password:unknown=testPassword,headers:Record<string,string>={}) {
 return new Request(origin+'/api/auth/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','CF-Connecting-IP':'192.0.2.1',...headers},body:JSON.stringify({password})});
}
function withCookie(path:string,cookie:string,method='GET') { return new Request(origin+path,{method,headers:{Cookie:cookie.split(';')[0]}}); }

test('session expires exactly seven days after login and cannot be forged or reused after rotation',async()=>{
 const {db}=database(),env=environment(db),token=await createSession(env,clock);
 assert.deepEqual(await verifySession(token,env,clock),{issuedAt:clock,expiresAt:clock+SESSION_MS});
 assert.ok(await verifySession(token,env,clock+SESSION_MS-1));
 assert.equal(await verifySession(token,env,clock+SESSION_MS),null);
 assert.equal(await verifySession(token,env,clock-6000),null);
 assert.equal(await verifySession(token.slice(0,-4)+'abcd',env,clock),null);
 assert.equal(await verifySession('forged.not-a-mac',env,clock),null);
 assert.equal(await verifySession(token+'.extra',env,clock),null);
 assert.equal(await verifySession('x'.repeat(513),env,clock),null);
 assert.equal(await verifySession(token,{...env,SITE_PASSWORD_SHA256:await passwordDigest('rotated-password')},clock),null);
 assert.equal(await verifySession(token,{...env,SITE_SESSION_SECRET:'b8'.repeat(32)},clock),null);
 const body=JSON.parse(Buffer.from(token.split('.')[0],'base64url').toString());
 assert.deepEqual(body.slice(0,3),[1,clock,clock+SESSION_MS]);
 assert.ok(!token.includes(env.SITE_PASSWORD_SHA256!));
});

test('login sets a host-only secure HttpOnly cookie, exposes no secrets, and never slides expiry',async()=>{
 const {db}=database(),env=environment(db),r=(await authBoundary(login(),env,clock))!;
 assert.equal(r.status,200);
 const cookie=r.headers.get('set-cookie')!;
 assert.match(cookie,/^__Host-md_session=/);for(const part of ['Path=/','Max-Age=604800','HttpOnly','Secure','SameSite=Lax'])assert.ok(cookie.includes(part));
 assert.ok(!cookie.includes('Domain='));assert.equal(r.headers.get('cache-control'),'no-store');
 const body=await r.text();assert.ok(![testPassword,env.SITE_PASSWORD_SHA256!,env.SITE_SESSION_SECRET!,env.HISTORY_READ_TOKEN].some(secret=>body.includes(secret)));
 const result=JSON.parse(body);assert.equal(result.expiresAt,clock+SESSION_MS);
 for(const later of [clock+1000,clock+SESSION_MS-1000]){
  const session=(await authBoundary(withCookie('/api/auth/session',cookie),env,later))!;
  assert.equal((await session.json() as any).expiresAt,clock+SESSION_MS);assert.equal(session.headers.get('set-cookie'),null);
  const req=login();req.headers.set('Cookie',cookie.split(';')[0]);
  const repeat=(await authBoundary(req,env,later))!;
  assert.equal((await repeat.json() as any).expiresAt,clock+SESSION_MS);assert.equal(repeat.headers.get('set-cookie'),null);
 }
 await assert.rejects(()=>requireRailwaySession(withCookie('/api/status',cookie),env,clock+SESSION_MS),RailwayAuthRequired);
 const fresh=(await authBoundary(login(),env,clock+SESSION_MS))!;assert.equal((await fresh.json() as any).expiresAt,clock+2*SESSION_MS);
});

test('login rejects incorrect passwords, malformed bodies, missing or foreign Origin',async()=>{
 const {db}=database(),env=environment(db);
 const wrong=(await authBoundary(login('incorrect'),env,clock))!;
 assert.equal(wrong.status,401);assert.equal((await wrong.json() as any).error.code,'INVALID_PASSWORD');assert.equal(wrong.headers.get('set-cookie'),null);
 for(const value of ['', 'https://foreign.test'])assert.equal((await authBoundary(login(testPassword,{Origin:value}),env,clock))!.status,403);
 assert.equal((await authBoundary(login(testPassword,{'Content-Type':'text/plain'}),env,clock))!.status,400);
 for(const value of [123,null,'a'.repeat(257)])assert.equal((await authBoundary(login(value),env,clock))!.status,400);
 assert.equal((await authBoundary(new Request(origin+'/api/auth/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{invalid'}),env,clock))!.status,400);
});

test('D1 atomically limits concurrent login attempts across isolates and preserves data and collector gate',async()=>{
 const {db,raw}=database(),env=environment(db);
 raw.prepare('INSERT INTO md_gate VALUES(?,?,?,?)').run('collector','existing',clock+45000,clock+600);
 raw.prepare('INSERT INTO md_snapshots VALUES(?,?,?)').run('v3-history-fixture','{"nulls":[null,0]}',clock);
 const results=await Promise.all(Array.from({length:20},()=>authBoundary(login('incorrect'),{...env},clock)));
 assert.equal(results.filter(r=>r?.status===401).length,10);
 assert.equal(results.filter(r=>r?.status===429).length,10);
 assert.equal(results.find(r=>r?.status===429)!.headers.get('retry-after'),'900');
 assert.equal((await authBoundary(login(),{...env},clock+899999))!.status,429);
 assert.equal((await authBoundary(login(),{...env},clock+900000))!.status,200);
 assert.equal((await authBoundary(login(testPassword,{'CF-Connecting-IP':'192.0.2.2'}),env,clock))!.status,200);
 assert.deepEqual({...raw.prepare('SELECT * FROM md_gate').get()},{key:'collector',owner:'existing',lease_until:clock+45000,next_at:clock+600});
 assert.equal((raw.prepare("SELECT body FROM md_snapshots WHERE key='v3-history-fixture'").get() as any).body,'{"nulls":[null,0]}');
 assert.ok(!JSON.stringify(raw.prepare("SELECT key FROM md_snapshots WHERE key LIKE 'v3-auth-rate:%'").all()).includes('192.0.2.'));
});

test('public research and monitor HTML, status and local job metadata never require login',async t=>{
 const {db}=database(),env=environment(db);let upstream=0;
 const original=globalThis.fetch;globalThis.fetch=async()=>{upstream++;throw new Error('No upstream');};t.after(()=>{globalThis.fetch=original;});
 for(const path of ['/','/monitor','/index.html','/health','/api/status','/api/depth/backfill/status?hours=24']){
  const r=await worker.fetch(new Request(origin+path),env,{} as ExecutionContext);assert.equal(r.status,200);
 }
 for(const method of ['HEAD','POST'])assert.equal((await worker.fetch(new Request(origin+'/api/depth/live-gap',{method}),env,{} as ExecutionContext)).status,405);
 const r=await worker.fetch(new Request(origin+'/api/depth/live-gap'),env,{} as ExecutionContext);
 assert.equal(r.status,401);assert.equal((await r.json() as any).error.code,'AUTH_REQUIRED');assert.equal(upstream,0);
});
test('missing login secrets only fail closed for authentication and Railway, public HTML remains usable',async()=>{
 const {db}=database(),env=environment(db);
 for(const key of ['SITE_PASSWORD_SHA256','SITE_SESSION_SECRET'] as const){
  const missing={...env,[key]:undefined};assert.equal(await authBoundary(new Request(origin+'/'),missing,clock),null);
  assert.equal((await authBoundary(new Request(origin+'/api/auth/session'),missing,clock))!.status,503);
  await assert.rejects(()=>requireRailwaySession(new Request(origin+'/api/status'),missing,clock),RailwayAuthRequired);
 }
 const request=await authorizedRequest(env,origin+'/',{headers:{Cookie:'md_client=existing-client'}});
 const root=await worker.fetch(request,env,{} as ExecutionContext);assert.equal(root.status,200);assert.equal(root.headers.get('cache-control'),'no-store');assert.equal(root.headers.get('set-cookie'),null);
 const cookie=sessionCookie(new Request('http://127.0.0.1:8787/'),await createSession(env,clock));assert.match(cookie,/^md_local_session=/);assert.ok(!cookie.includes('; Secure'));
});

test('same-site fallback sends the login cookie and recognizes only AUTH_REQUIRED without consuming response',async t=>{
 const original=globalThis.fetch;let expired=0,credentials:RequestCredentials|undefined;
 globalThis.fetch=async(_input,init)=>{credentials=init?.credentials;return new Response(JSON.stringify({ok:false,error:{code:'AUTH_REQUIRED'}}),{status:401});};t.after(()=>{globalThis.fetch=original;});
 const r=await siteFetch('/api/exchanges/depth',{credentials:'omit'},()=>{expired++;});
 assert.equal(credentials,'same-origin');assert.equal(expired,1);assert.equal((await r.json() as any).error.code,'AUTH_REQUIRED');
 globalThis.fetch=async()=>new Response(JSON.stringify({error:{code:'UPSTREAM_AUTH_ERROR'}}),{status:401});
 await siteFetch('/api/status',{},()=>{expired++;});assert.equal(expired,1);
});
