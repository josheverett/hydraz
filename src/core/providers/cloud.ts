import { execFileSync } from 'node:child_process';
import { LocalContainerProvider } from './local-container.js';
import type { ProviderCheckResult } from './provider.js';
import { checkDevPodAvailability } from './devpod.js';
import { debug } from '../debug.js';

export class CloudProvider extends LocalContainerProvider {
  readonly type = 'cloud' as const;

  checkAvailability(): ProviderCheckResult {
    debug('checkAvailability [cloud]: verifying git');
    try {
      execFileSync('git', ['--version'], { stdio: 'pipe' });
    } catch {
      debug('checkAvailability [cloud]: git not found');
      return { available: false, error: 'git is not available on PATH' };
    }

    debug('checkAvailability [cloud]: verifying devpod');
    const devpodCheck = checkDevPodAvailability();
    if (!devpodCheck.available) {
      debug(`checkAvailability [cloud]: devpod not available — ${devpodCheck.error}`);
      return { available: false, error: devpodCheck.error };
    }
    debug(`checkAvailability [cloud]: devpod ${devpodCheck.version}`);
    debug('checkAvailability [cloud]: all prerequisites met (Docker not required for cloud)');

    return { available: true };
  }
}
