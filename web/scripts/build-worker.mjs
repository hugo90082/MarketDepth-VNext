import { build } from 'vite';
import { mkdir, readFile, writeFile, cp } from 'node:fs/promises';
await mkdir('dist/server', { recursive: true });
const html=await readFile('dist/server/app-shell.html','utf8');
await build({ configFile: false, define:{__SITE_HTML__:JSON.stringify(html)},build: { outDir: 'dist/server', emptyOutDir: false, minify: false, lib: { entry: 'worker/index.ts', formats: ['es'], fileName: 'index' } } });
await writeFile('dist/server/wrangler.json', JSON.stringify({
  name: 'marketdepth-observatory', main: 'index.js', compatibility_date: '2026-05-15',
  assets: { directory: '../client', binding: 'ASSETS', run_worker_first: true },
  d1_databases: [{ binding: 'DB', database_name: 'site-creator-d1', database_id: '00000000-0000-4000-8000-000000000000' }],
  no_bundle: true, rules: [{ type: 'ESModule', globs: ['**/*.js', '**/*.mjs'] }],
}, null, 2));
const config = JSON.parse(await readFile('.openai/hosting.json', 'utf8'));
await mkdir('dist/.openai', { recursive: true });
await writeFile('dist/.openai/hosting.json', JSON.stringify(config, null, 2));
await cp('drizzle', 'dist/.openai/drizzle', { recursive: true });
console.log('Sites Worker + D1 artifact ready. No Railway resource required.');
