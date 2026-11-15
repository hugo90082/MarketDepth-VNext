// Auth QA never dispatches Railway or creates historical jobs. Secrets stay in process memory.
import assert from 'node:assert/strict';
const base='https://marketdepth-observatory.magic-knoll-8651.chatgpt.site';
const read=(path,headers={})=>fetch(base+path,{headers,redirect:'manual',signal:AbortSignal.timeout(15000)});
const response=await read('/');assert.equal(response.status,302);assert.equal(response.headers.get('location'),'/login');
const page=await read('/login');assert.equal(page.status,200);assert.equal(page.headers.get('cache-control'),'no-store');assert.match(await page.text(),/name="robots"[^>]*noindex/);
for(const path of ['/api/status','/api/depth/recent','/api/depth/history','/api/klines','/api/depth/backfill/status?hours=24','/api/exchanges/depth?kind=binance&asset=BTC']){
 const r=await read(path);assert.equal(r.status,401);assert.equal((await r.json()).error.code,'AUTH_REQUIRED');
}
const anon=await read('/api/auth/session');assert.equal((await anon.json()).authenticated,false);
console.log('PASS anonymous login redirect, noindex and protected data APIs');
if(process.env.SITE_QA_PASSWORD){
 const r=await fetch(base+'/api/auth/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({password:process.env.SITE_QA_PASSWORD}),signal:AbortSignal.timeout(15000)});
 assert.equal(r.status,200);const body=await r.json();assert.equal(body.expiresAt-body.serverNowMs,604800000);
 const cookie=r.headers.getSetCookie().find(value=>value.startsWith('__Host-md_session='));assert.ok(cookie,'Login cookie missing');assert.ok(cookie.includes('HttpOnly'));assert.ok(cookie.includes('Secure'));assert.ok(cookie.includes('SameSite=Lax'));
 const headers={Cookie:cookie.split(';')[0]};
 const session=await read('/api/auth/session',headers);assert.equal((await session.json()).expiresAt,body.expiresAt);assert.ok(!session.headers.getSetCookie().some(value=>value.startsWith('__Host-md_session=')),'App login cookie must not be renewed');
 const status=await read('/api/status',headers);assert.equal(status.status,200);assert.equal((await status.json()).schema,'MD-SPOT-30S-USD-3');assert.match(status.headers.get('x-robots-tag'),/noindex/);
 for(const path of ['/api/depth/recent','/api/depth/history','/api/klines'])assert.equal((await read(path,headers)).status,410);
 console.log('PASS authenticated v3 status, seven-day cookie, no renewal and retired routes');
}
