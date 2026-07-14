import { existsSync } from 'node:fs';
import { join } from 'node:path';

export const PLAYWRIGHT_VERSION = '1.61.1';
export const PLAYWRIGHT_RUNTIME_ASSET = 'runtime/playwright-runtime.tar.gz';

export function resolvePlaywrightRuntimeArchive(distRoot: string): string {
  const archive = join(distRoot, PLAYWRIGHT_RUNTIME_ASSET);
  if (!existsSync(archive)) {
    throw new Error(
      `Missing packaged Playwright ${PLAYWRIGHT_VERSION} runtime at ${archive}. ` +
      'Rebuild or reinstall Hydraz before using container or cloud mode.',
    );
  }
  return archive;
}
