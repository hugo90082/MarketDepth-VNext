import { Miniflare } from 'miniflare';
import { readdir,readFile } from 'node:fs/promises';
const token=process.env.HISTORY_READ_TOKEN;
if(!token && process.env.MARKETDEPTH_HISTORY_DISABLED !== '1') throw new Error('Set HISTORY_READ_TOKEN in this process only, or MARKETDEPTH_HISTORY_DISABLED=1 for exchange-only QA.');
const mf=new Miniflare({
  modules:true,scriptPath:'dist/server/index.js',compatibilityDate:'2026-05-15',
  port:8787,host:'127.0.0.1',d1Databases:{DB:'marketdepth-local'},d1Persist:'.cache/d1',
  bindings:{HISTORY_READ_TOKEN:token||'',MARKETDEPTH_BASE_URL:'https://marketdepth-production.up.railway.app',SITE_PASSWORD_SHA256:process.env.SITE_PASSWORD_SHA256||'',SITE_SESSION_SECRET:process.env.SITE_SESSION_SECRET||'',MARKET_HISTORY_PRIMARY_SOURCE:process.env.MARKET_HISTORY_PRIMARY_SOURCE||''},
  assets:{directory:'dist/client',binding:'ASSETS',routerConfig:{has_user_worker:true,invoke_user_worker_ahead_of_assets:true}},
});
const db=await mf.getD1Database('DB');
await db.prepare('CREATE TABLE IF NOT EXISTS local_migrations (name TEXT PRIMARY KEY)').run();
for(const name of (await readdir('drizzle')).filter(n=>n.endsWith('.sql')).sort()){
  if(await db.prepare('SELECT name FROM local_migrations WHERE name=?').bind(name).first())continue;
  const sql=await readFile('drizzle/'+name,'utf8');
  await db.batch([...sql.split('--> statement-breakpoint').map(s=>db.prepare(s.trim())),db.prepare('INSERT INTO local_migrations(name) VALUES(?)').bind(name)]);
}
console.log('Local Sites BFF:',String(await mf.ready));
async function close(){await mf.dispose();process.exit(0);}
process.once('SIGINT',close);process.once('SIGTERM',close);
