// Module resolve hook: while gen and agent-core are unmerged, point their modules at the local
// doubles. Once the real module exists it resolves first and the double is never used.
const DOUBLES: Record<string, string> = {
  '@mochi/gen': './gen.ts',
  '../story-doc.ts': './story-doc.ts',
  '../db.ts': './db.ts',
};

export async function resolve(specifier: string, context: any, next: any) {
  try {
    return await next(specifier, context);
  } catch (e: any) {
    const double = DOUBLES[specifier];
    if (!double || (e?.code !== 'ERR_MODULE_NOT_FOUND' && e?.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED')) throw e;
    return next(new URL(double, import.meta.url).href, context);
  }
}
