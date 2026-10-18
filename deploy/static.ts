// The static sites, served by the one agent process (SPEC §4/§4b): landing at /, desk at /app, blog at /blog.
// Hookup in agent/server.ts `handle`, just before the final 404:
//   if (serveStatic(req, res)) return;        // import { serveStatic } from '../deploy/static.ts';
// Returns false for /api/*, /sim/*, non-GET and missing files, so the API keeps answering those.
import { createReadStream, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
const LANDING = join(repo, 'landing', 'dist');
const UI = join(repo, 'ui', 'dist');
const BLOG = join(repo, 'mochi-brain-blog.html');

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.vtt': 'text/vtt', '.mp4': 'video/mp4', '.txt': 'text/plain; charset=utf-8',
};

/** URL path -> file on disk, or null when it is not ours or would escape its root. */
export function staticPath(pathname: string): string | null {
  if (/^\/(api|sim)(\/|$)/.test(pathname)) return null;
  if (pathname === '/blog' || pathname === '/blog/') return BLOG;
  const [root, rest] = pathname === '/app' || pathname.startsWith('/app/') ? [UI, pathname.slice(4)] : [LANDING, pathname];
  const file = join(root, rest);
  return file === root || file.startsWith(root + sep) ? file : null;
}

export function serveStatic(req: IncomingMessage, res: ServerResponse): boolean {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  let file: string | null;
  try { file = staticPath(decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)); } catch { return false; }
  if (!file) return false;
  let size: number;
  try {
    if (statSync(file).isDirectory()) file = join(file, 'index.html');
    size = statSync(file).size;
  } catch { return false; }
  const headers = {
    'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'accept-ranges': 'bytes',
    'cache-control': file.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
  };
  // Safari plays video only through 206 range responses. One range per request; multi-range falls back to 200.
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  let start = 0, end = size - 1, status = 200;
  if (m && (m[1] || m[2])) {
    if (m[1]) { start = Number(m[1]); if (m[2]) end = Math.min(Number(m[2]), size - 1); }
    else start = Math.max(0, size - Number(m[2]));
    if (start > end) { res.writeHead(416, { 'content-range': `bytes */${size}` }).end(); return true; }
    status = 206;
    Object.assign(headers, { 'content-range': `bytes ${start}-${end}/${size}` });
  }
  res.writeHead(status, { ...headers, 'content-length': end - start + 1 });
  if (req.method === 'HEAD' || size === 0) res.end();
  else createReadStream(file, { start, end }).pipe(res);
  return true;
}
