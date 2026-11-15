/// <reference types="@cloudflare/workers-types" />
export interface Env { DB: D1Database; ASSETS: Fetcher; HISTORY_READ_TOKEN: string; MARKETDEPTH_BASE_URL?: string; SITE_PASSWORD_SHA256?: string; SITE_SESSION_SECRET?: string; MARKET_HISTORY_PRIMARY_SOURCE?:string }
// Both Historical and Recent share this persisted D1 gate. A 600 ms gap stays
// below the backend's two-successful-requests-per-rolling-second allowance.
export const UPSTREAM_GAP_MS = 600;
// Per-isolate optimization only; correctness lives in D1, not process memory.
const initialized = new WeakMap<object, Promise<void>>();
export function initialize(db: D1Database) {
  let task = initialized.get(db);
  if (!task) {
    // Schema belongs to generated migrations, never runtime DDL.
    task = db.batch([
      db.prepare("INSERT OR IGNORE INTO md_snapshots(key,body,updated_at) VALUES('v3-reset','true',0)"),
      // Retry scoped data cleanup after the retired routes are already blocked.
      // An old isolate can finish a metadata write during schema deployment.
      db.prepare("DELETE FROM md_snapshots WHERE key LIKE 'shared-%'"),
      db.prepare("DELETE FROM md_gate WHERE key LIKE 'shared-%'"),
    ]).then(() => {});
    initialized.set(db, task);
    task.catch(() => initialized.delete(db));
  }
  return task;
}
export async function readSnapshot<T>(db: D1Database, key: string): Promise<T | null> {
  const row = await db.prepare('SELECT body FROM md_snapshots WHERE key = ?').bind(key).first<{ body: string }>();
  return row ? JSON.parse(row.body) as T : null;
}
export async function saveSnapshot(db: D1Database, key: string, body: unknown, now: number) {
  await db.prepare('INSERT INTO md_snapshots(key,body,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET body=excluded.body, updated_at=excluded.updated_at').bind(key, JSON.stringify(body), now).run();
}
/** Conditional UPDATE is atomic at D1 primary; exactly one requester wins. */
export async function claim(db: D1Database, key: string, now: number, owner: string, leaseMs = 45_000, budgetMs = 60_000) {
  await db.prepare('INSERT OR IGNORE INTO md_gate(key) VALUES(?)').bind(key).run();
  const result = await db.prepare('UPDATE md_gate SET owner=?, lease_until=?, next_at=? WHERE key=? AND lease_until<=? AND next_at<=?').bind(owner, now + leaseMs, now + budgetMs, key, now, now).run();
  return result.meta.changes === 1;
}
export async function release(db: D1Database, key: string, owner: string, nextAt: number) {
  await db.prepare('UPDATE md_gate SET lease_until=0, next_at=MAX(next_at,?) WHERE key=? AND owner=?').bind(nextAt, key, owner).run();
}
export async function owns(db: D1Database, key: string, owner: string, now: number) {
  return !!await db.prepare('SELECT key FROM md_gate WHERE key=? AND owner=? AND lease_until>?').bind(key, owner, now).first();
}
