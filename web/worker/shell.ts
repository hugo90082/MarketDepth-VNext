import type { Env } from './db';

// The generated HTML belongs to the authenticated Worker, not the public
// asset router. Sites may serve matching static assets before invoking it.
declare const __SITE_HTML__: string;
export async function siteShell(request: Request, env: Env): Promise<Response> {
 const html = typeof __SITE_HTML__ === 'string' ? __SITE_HTML__ : await (await env.ASSETS.fetch(new Request(new URL('/',request.url)))).text();
 return new Response(request.method === 'HEAD' ? null : html, { headers: {
  'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store',
  'X-Robots-Tag':'noindex, nofollow','X-Content-Type-Options':'nosniff',
 } });
}
