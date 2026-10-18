import assert from 'node:assert/strict';
import { test } from 'node:test';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';
import { serveStatic, staticPath } from './static.ts';

const repo = fileURLToPath(new URL('..', import.meta.url));

test('routes', () => {
  assert.equal(staticPath('/'), join(repo, 'landing/dist/'));
  assert.equal(staticPath('/app'), join(repo, 'ui/dist'));
  assert.equal(staticPath('/app/assets/x.js'), join(repo, 'ui/dist/assets/x.js'));
  assert.equal(staticPath('/blog'), join(repo, 'mochi-brain-blog.html'));
  assert.equal(staticPath('/apple.png'), join(repo, 'landing/dist/apple.png'));
});

test('api, sim and traversal are declined', () => {
  for (const p of ['/api/stories', '/api', '/sim/api/v2/tickets'])
    assert.equal(staticPath(p), null);
  assert.equal(staticPath('/app/../../.env'), null);
  assert.equal(staticPath('/../package.json'), null);
});

test('Range: bytes=0-99 returns 206 with 100 bytes', async () => {
  const srv = createServer((req, res) => { if (!serveStatic(req, res)) res.writeHead(404).end(); }).listen(0);
  await once(srv, 'listening');
  try {
    const r = await fetch(`http://127.0.0.1:${(srv.address() as AddressInfo).port}/blog`, { headers: { range: 'bytes=0-99' } });
    assert.equal(r.status, 206);
    assert.match(r.headers.get('content-range') ?? '', /^bytes 0-99\/\d+$/);
    assert.equal((await r.arrayBuffer()).byteLength, 100);
  } finally { srv.close(); }
});
