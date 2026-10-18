import assert from 'node:assert/strict';
import { test } from 'node:test';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { staticPath } from './static.ts';

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
