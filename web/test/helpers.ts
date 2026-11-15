import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import type { Env } from '../worker/db';
import type { SpotRow } from '../shared/model';
import { createSession, sessionCookie } from '../worker/auth';
export function database() {
  const raw = new DatabaseSync(':memory:');
  for (const f of readdirSync('drizzle').filter(f => f.endsWith('.sql'))) raw.exec(readFileSync('drizzle/' + f, 'utf8'));
  function prepare(sql: string) {
    let values: unknown[] = [];
    const api = {
      bind(...args: unknown[]) { values = args; return api; },
      async first(column?: string) { const row = raw.prepare(sql).get(...values as never[]) as Record<string, unknown> | undefined; return row ? column ? row[column] : row : null; },
      async all() { return { results: raw.prepare(sql).all(...values as never[]), success: true, meta: {} }; },
      run() { const result = raw.prepare(sql).run(...values as never[]); return Promise.resolve({ success: true, meta: { changes: Number(result.changes) } }); },
    };
    return api;
  }
  const db = { prepare, async batch(statements: ReturnType<typeof prepare>[]) { raw.exec('BEGIN');try{const result=statements.map(s=>s.run());raw.exec('COMMIT');return Promise.all(result);}catch(e){raw.exec('ROLLBACK');throw e;} } } as unknown as D1Database;
  return { db, raw };
}
export const testPassword='local-auth-test-only';
export function environment(db: D1Database): Env { return { DB: db, HISTORY_READ_TOKEN: 'test-secret-only', SITE_PASSWORD_SHA256:createHash('sha256').update(testPassword).digest('hex'),SITE_SESSION_SECRET:'a7'.repeat(32), ASSETS: { fetch: async () => new Response('<html>site</html>',{headers:{'content-type':'text/html'}}) } as unknown as Fetcher }; }
export async function authorizedRequest(env:Env,url:string,init:RequestInit={}) {
 const request=new Request(url,init),headers=new Headers(request.headers);
 const cookie=sessionCookie(request,await createSession(env)).split(';')[0];
 headers.set('Cookie',[headers.get('Cookie'),cookie].filter(Boolean).join('; '));
 return new Request(request,{headers});
}
export function row(t=1_790_350_200_000): SpotRow { return { t, a: t+200, d:Array.from({length:4},()=>Array.from({length:3},()=>Array.from({length:5},()=>[100,50]))) }; }
export function response(body: unknown, status=200,headers:Record<string,string>={}) { return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json',...headers}}); }
export const health={ok:true,schema:'MARKET_DEPTH_COLLECTION_30S_5ZONE_USD_3',spotSchema:'MD-SPOT-30S-USD-3',depthUnit:'USD_NOTIONAL',quoteToUSDPolicy:'RAW_QUOTE_PRICE_ASSUMED_USD_1_TO_1_NO_FX',spotCadenceMs:30_000};
