// Exercise the actual built Worker with asset-first routing, matching Sites.
// Uses ephemeral test credentials; never reads production secrets or Railway.
import assert from 'node:assert/strict';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { Miniflare } from 'miniflare';
assert.equal(existsSync('dist/client/index.html'),false,'Protected HTML must not be a public index asset');
const digest=createHash('sha256').update('local-auth-test-only').digest('hex'),secret='a7'.repeat(32),now=Date.now();
const body=Buffer.from(JSON.stringify([1,now,now+604800000,randomUUID()])).toString('base64url');
const token=body+'.'+createHmac('sha256',Buffer.from(secret,'hex')).update(body+':'+digest).digest('base64url');
const mf=new Miniflare({
 modules:true,scriptPath:'dist/server/index.js',compatibilityDate:'2026-05-15',
 bindings:{SITE_PASSWORD_SHA256:digest,SITE_SESSION_SECRET:secret,HISTORY_READ_TOKEN:''},
 assets:{directory:'dist/client',binding:'ASSETS',routerConfig:{has_user_worker:true,invoke_user_worker_ahead_of_assets:false}},
});
try {
 const read=(path,headers={})=>mf.dispatchFetch('https://site.test'+path,{headers,redirect:'manual'});
 const anon=await read('/');assert.equal(anon.status,302);assert.equal(anon.headers.get('location'),'/login');
 const login=await read('/login');assert.equal(login.status,200);assert.equal(login.headers.get('cache-control'),'no-store');assert.match(await login.text(),/name="robots"[^>]*noindex/);
 for(const path of ['/api/status','/api/depth/live-gap','/api/exchanges/depth?kind=binance&asset=BTC']){const r=await read(path);assert.equal(r.status,401);assert.equal((await r.json()).error.code,'AUTH_REQUIRED');}
 const main=await read('/',{Cookie:'__Host-md_session='+token});assert.equal(main.status,200);assert.equal(main.headers.get('cache-control'),'no-store');assert.match(main.headers.get('x-robots-tag'),/noindex/);
 const html=await main.text(),asset=html.match(/src="(\/assets\/[^"\s]+\.js)"/)[1];assert.equal((await read(asset)).status,200);
 const session=await read('/api/auth/session',{Cookie:'__Host-md_session='+token});assert.equal((await session.json()).expiresAt,now+604800000);assert.equal(session.headers.get('set-cookie'),null);
 console.log('PASS built Worker: asset-first HTML gate, login shell, protected APIs, authenticated HTML and public bundle');
} finally { await mf.dispose(); }
