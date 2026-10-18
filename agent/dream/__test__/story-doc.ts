// Test double of agent-core's StoryDoc (add-agent-core design decision 4): one session doc, id → versions[].
import { defineDoc } from '@earendil-works/pi-durable';

export const StoryDoc = defineDoc<Record<string, any>>({ // id → Story[]
  kind: 'mochi.story', version: 1, scope: 'session', initial: () => ({}),
});
