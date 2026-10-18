// Every story (morning report and build_story output) in one session doc: id -> versions, version n = versions[n-1].
// ponytail: one doc for all stories; split per story (defineDocFamily) if the count grows past hundreds.
import { defineDoc, type JsonObject } from '@earendil-works/pi-durable';

// Values are contract `Story` objects (parseStory-checked on commit); typed as JSON for the doc store.
// `meta` is agent-side publishing state; a story without meta (dream reports, pre-panel builds) is public.
export const StoryDoc = defineDoc<{ stories: Record<string, JsonObject[]>; meta?: Record<string, JsonObject> }>({
  kind: 'mochi.story',
  version: 1,
  scope: 'session',
  initial: () => ({ stories: {}, meta: {} }),
});
