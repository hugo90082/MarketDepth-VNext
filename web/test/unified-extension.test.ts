import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createPublicManifest} from '../work/extension-v1.4.2/src/lib/public-manifest.js';
test('published extension preserves old bridge sites, supports MarketDepth SPA routes and matches its release checksum',async()=>{
 const manifest=JSON.parse(await readFile('work/extension-v1.4.2/manifest.json','utf8'));
 const generated=createPublicManifest(manifest);
 assert.ok(generated.host_permissions.every((url:string)=>!url.startsWith('http://')));
 assert.ok(generated.content_scripts.every((entry:any)=>entry.matches.every((url:string)=>!url.startsWith('http://'))));
 assert.equal(manifest.version,'1.4.1');
 assert.ok(!manifest.host_permissions.some((url:string)=>url.includes('liquidations')));
 const bridge=manifest.content_scripts.find((s:any)=>s.js.includes('depthwatch-content.js'));
 for(const origin of ['marketdepth-observatory','order-book-depth-ratio-monitor'])assert.ok(bridge.matches.includes(`https://${origin}.magic-knoll-8651.chatgpt.site/*`));
 assert.equal(manifest.host_permissions.includes('<all_urls>'),false);
 const release=JSON.parse(await readFile('public/downloads/release.json','utf8')),bytes=await readFile('public/downloads/'+release.fileName);
 assert.equal(bytes.length,release.sizeBytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),release.sha256);
 const source=await readFile('src/monitor/alert-log-panel.tsx','utf8');assert.ok(source.includes(release.sha256));assert.ok(source.includes(release.fileName));
});
