import type { Env } from './db';
import { siteShell } from './shell';

export const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const encoder = new TextEncoder();
export type Session = { issuedAt: number; expiresAt: number };
let cachedKey: { secret: string; key: Promise<CryptoKey> } | undefined;

export function authConfigured(env: Env): boolean {
 return /^[a-f0-9]{64}$/.test(env.SITE_PASSWORD_SHA256 ?? '') && /^[a-f0-9]{64}$/.test(env.SITE_SESSION_SECRET ?? '');
}
function key(env: Env) {
 const secret = env.SITE_SESSION_SECRET!;
 if (cachedKey?.secret !== secret) cachedKey = { secret, key: crypto.subtle.importKey('raw', new Uint8Array(secret.match(/../g)!.map(x => parseInt(x, 16))), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']) };
 return cachedKey.key;
}
function encode(bytes: Uint8Array): string {
 let binary = ''; for (const b of bytes) binary += String.fromCharCode(b);
 return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decode(text: string): Uint8Array<ArrayBuffer> {
 if (!/^[A-Za-z0-9_-]+$/.test(text)) throw new Error('INVALID_SESSION');
 const raw = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - text.length % 4) % 4));
 return Uint8Array.from(raw, c => c.charCodeAt(0));
}
export async function passwordDigest(password: string): Promise<string> {
 const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(password));
 return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
}
export async function createSession(env: Env, now = Date.now()): Promise<string> {
 if (!authConfigured(env)) throw new Error('AUTH_UNAVAILABLE');
 const body = encode(encoder.encode(JSON.stringify([1, now, now + SESSION_MS, crypto.randomUUID()])));
 // The current password digest is covered by the MAC without exposing it in the token.
 const signature = await crypto.subtle.sign('HMAC', await key(env), encoder.encode(body + ':' + env.SITE_PASSWORD_SHA256));
 return body + '.' + encode(new Uint8Array(signature));
}
export async function verifySession(token: string | null, env: Env, now = Date.now()): Promise<Session | null> {
 if (!authConfigured(env) || !token || token.length > 512) return null;
 try {
  const parts = token.split('.'); if (parts.length !== 2) return null;
  const valid = await crypto.subtle.verify('HMAC', await key(env), decode(parts[1]), encoder.encode(parts[0] + ':' + env.SITE_PASSWORD_SHA256));
  if (!valid) return null;
  const value: unknown = JSON.parse(new TextDecoder().decode(decode(parts[0])));
  if (!Array.isArray(value) || value.length !== 4 || value[0] !== 1 || !Number.isSafeInteger(value[1]) || !Number.isSafeInteger(value[2]) || typeof value[3] !== 'string' || value[3].length !== 36) return null;
  const [, issuedAt, expiresAt] = value;
  if (issuedAt > now + 5000 || expiresAt !== issuedAt + SESSION_MS || expiresAt <= now) return null;
  return { issuedAt, expiresAt };
 } catch { return null; }
}
function cookieDetails(request: Request) {
 const url = new URL(request.url), local = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
 return { name: local ? 'md_local_session' : '__Host-md_session', secure: local ? '' : '; Secure' };
}
export function sessionCookie(request: Request, token: string, maxAge = SESSION_MS / 1000): string {
 const { name, secure } = cookieDetails(request);
 return `${name}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly${secure}; SameSite=Lax`;
}
function tokenOf(request: Request) {
 const { name } = cookieDetails(request);
 return request.headers.get('cookie')?.split(';').map(x => x.trim()).find(x => x.startsWith(name + '='))?.slice(name.length + 1) ?? null;
}
/** Server-only binding; no session credential is returned to the client. */
export async function sessionIdentity(request:Request,env:Env,now=Date.now()){
 const token=tokenOf(request),session=await verifySession(token,env,now);if(!token||!session)return null;
 const bytes=await crypto.subtle.digest('SHA-256',encoder.encode(token));
 return {...session,id:[...new Uint8Array(bytes)].map(n=>n.toString(16).padStart(2,'0')).join('')};
}
function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
 return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff', ...headers } });
}
function error(code: string, status: number, headers: Record<string, string> = {}) { return json({ ok: false, error: { code } }, status, headers); }
function redirect(path: string, headers: Record<string, string> = {}) { return new Response(null, { status: 302, headers: { Location: path, 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', ...headers } }); }
async function attempt(env: Env, ip: string, now: number) {
 const signed = await crypto.subtle.sign('HMAC', await key(env), encoder.encode('login-ip:' + ip));
 const bucket = 'v3-auth-rate:' + encode(new Uint8Array(signed));
 // Separate snapshot keys keep login attempts away from the Collector request gate.
 await env.DB.prepare("DELETE FROM md_snapshots WHERE key LIKE 'v3-auth-rate:%' AND updated_at < ?").bind(now - 86400000).run();
 const row = await env.DB.prepare(`INSERT INTO md_snapshots(key,body,updated_at) VALUES(?,json_object('attempts',1,'until',?),?)
  ON CONFLICT(key) DO UPDATE SET body=json_object('attempts',CASE WHEN json_extract(md_snapshots.body,'$.until')<=? THEN 1 ELSE json_extract(md_snapshots.body,'$.attempts')+1 END,
  'until',CASE WHEN json_extract(md_snapshots.body,'$.until')<=? THEN ? ELSE json_extract(md_snapshots.body,'$.until') END),updated_at=? RETURNING body`)
  .bind(bucket, now + ATTEMPT_WINDOW_MS, now, now, now, now + ATTEMPT_WINDOW_MS, now).first<{ body: string }>();
 if (!row) throw new Error('AUTH_UNAVAILABLE');
 return JSON.parse(row.body) as { attempts: number; until: number };
}

/** Return a response when the auth layer handles or rejects a request. */
export async function authBoundary(request: Request, env: Env, now = Date.now()): Promise<Response | null> {
 const url = new URL(request.url), path = url.pathname;
 if (/^\/assets\/[A-Za-z0-9_.-]+$/.test(path) || path === '/favicon.svg') return null;
 const configured = authConfigured(env), session = configured ? await verifySession(tokenOf(request), env, now) : null;
 if (path === '/login' && (request.method === 'GET' || request.method === 'HEAD')) {
  if (session) return redirect('/');
  const out = await siteShell(request,env);
  if (tokenOf(request)) out.headers.append('Set-Cookie', sessionCookie(request, '', 0));
  return out;
 }
 if (!path.startsWith('/api/auth/')) return null;
 if (!configured) return error('AUTH_UNAVAILABLE', 503);
 if (path === '/api/auth/session' && request.method === 'GET') return json({ ok: true, authenticated: !!session, serverNowMs: now, expiresAt: session?.expiresAt ?? null }, 200, session ? {} : { 'Set-Cookie': sessionCookie(request, '', 0) });
 if (path === '/api/auth/login' && request.method === 'POST') {
  if (request.headers.get('origin') !== url.origin) return error('ORIGIN_NOT_ALLOWED', 403);
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return error('JSON_REQUIRED', 400);
  if (session) return json({ ok: true, authenticated: true, serverNowMs: now, expiresAt: session.expiresAt });
  try {
   if (!env.DB) return error('AUTH_UNAVAILABLE', 503);
   const budget = await attempt(env, request.headers.get('CF-Connecting-IP') ?? 'local', now);
   if (budget.attempts > 10) return error('LOGIN_RATE_LIMIT', 429, { 'Retry-After': String(Math.max(1, Math.ceil((budget.until - now) / 1000))) });
   const raw = await request.text(); if (raw.length > 2048) return error('BAD_LOGIN', 400);
   let password: unknown; try { password = JSON.parse(raw)?.password; } catch { return error('BAD_LOGIN', 400); }
   if (typeof password !== 'string' || password.length > 256) return error('BAD_LOGIN', 400);
   const actual = await passwordDigest(password); let difference = 0;
   for (let i = 0; i < actual.length; i++) difference |= actual.charCodeAt(i) ^ env.SITE_PASSWORD_SHA256!.charCodeAt(i);
   if (difference) return error('INVALID_PASSWORD', 401);
   const token = await createSession(env, now);
   return json({ ok: true, authenticated: true, serverNowMs: now, expiresAt: now + SESSION_MS }, 200, { 'Set-Cookie': sessionCookie(request, token) });
  } catch { return error('AUTH_UNAVAILABLE', 503); }
 }
 if (path.startsWith('/api/auth/')) return error('METHOD_OR_PATH_NOT_ALLOWED',405);
 return null;
}
export class RailwayAuthRequired extends Error {constructor(){super('AUTH_REQUIRED');}}
export async function requireRailwaySession(request:Request,env:Env,now=Date.now()) {
 if(!authConfigured(env)||!await verifySession(tokenOf(request),env,now))throw new RailwayAuthRequired();
}
export function railwayAuthResponse(request:Request){return error('AUTH_REQUIRED',401,{'Set-Cookie':sessionCookie(request,'',0)});}
