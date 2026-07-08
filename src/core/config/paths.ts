import { homedir } from 'node:os';
import { join } from 'node:path';

export interface ConfigPaths {
  configDir: string;
  configFile: string;
}

export function resolveConfigPaths(overrideDir?: string): ConfigPaths {
  const configDir = overrideDir ?? join(homedir(), '.config', 'hydraz');

  return {
    configDir,
    configFile: join(configDir, 'config.json'),
  };
}
