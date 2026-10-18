// One real-model run (MOCHI_MODEL, default claude-haiku-5-5): extraction + suggestion prose.
// Costs a few Haiku calls, so it runs only with MOCHI_DREAM_LIVE=1.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStory } from '@mochi/contracts';
import { loadEnv } from '../../contracts/testdb.ts';
import { AS_OF, fixture } from './__test__/fixture.ts';

const { runDreamNow, resolveModel } = await import('./index.ts');

test('live model: extraction validates and prose lands in the story', { skip: process.env.MOCHI_DREAM_LIVE !== '1' }, async (t) => {
  loadEnv();
  const f = await fixture('live');
  t.after(f.cleanup);
  const r = await runDreamNow({ db: f.db, as_of: AS_OF, model: resolveModel(), graphs: f.graphs, events: f.dataset.contradiction_events });
  console.log(JSON.stringify({ ingested: r.ingested, dropped: r.dropped, usage: r.usage, suggestions: r.suggestions }));
  assert.equal(r.ingested + r.dropped, 2);
  assert.ok(r.ingested >= 1, 'D-1 (a login ticket) extracts into the closed vocabulary');
  assert.ok(r.usage.extract.input > 0 && r.usage.suggest.calls === 2);
  assert.ok(parseStory(r.story).ok);
  assert.doesNotMatch(r.story!.body, /Write it down or fix the cause|Update the promise or fix/, 'model prose, not the template fallback');
  console.log(r.story!.body);
});
