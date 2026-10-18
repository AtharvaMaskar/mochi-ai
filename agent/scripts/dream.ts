// `npm run dream`: run the dream once now (runDreamNow as mochi_dream). Stop `npm run dev` first: one process per SQLite.
import { closeAll } from '../db.ts';
import { DREAM_NOT_INSTALLED, loadDream } from '../dream-port.ts';
import { openHarness } from '../harness.ts';
import { runDream } from '../server.ts';

const dream = await loadDream();
if (!dream) {
  console.error(DREAM_NOT_INSTALLED);
  process.exit(1);
}
const pi = await openHarness({ dream });
const asOf = process.argv[2] ? Number(process.argv[2]) : undefined;
console.log(JSON.stringify(await runDream(pi, dream, asOf), null, 2));
await pi.close();
await closeAll();
