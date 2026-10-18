// Tier isolation: every REFUSAL_CASES entry executed as mochi_reader; each must be refused by FalkorDB.
import { ACL, REFUSAL_CASES, type Results } from '@mochi/contracts';
import { connect } from '../db.ts';

export async function runIsolation(): Promise<Pick<Results, 'tier_isolation'>> {
  const db = await connect(ACL.reader.user, ACL.reader.passwordEnv);
  try {
    const cases: NonNullable<Results['tier_isolation']>['cases'] = [];
    for (const c of REFUSAL_CASES) {
      try { await c.run(db); cases.push({ case: c.case, refused: false, error: '' }); }
      catch (e) { cases.push({ case: c.case, refused: true, error: (e as Error).message }); }
    }
    return { tier_isolation: { cases } };
  } finally { await db.close(); }
}
