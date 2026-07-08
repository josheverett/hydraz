import { mkdirSync } from 'node:fs';
import { resolveConfigPaths } from './paths.js';
import { assertConfigPathNotSymlink } from './protected-path.js';
import { configExists, saveConfig } from './loader.js';
import { createDefaultConfig } from './schema.js';

export function initializeConfigDir(configDir?: string): void {
  const paths = resolveConfigPaths(configDir);

  assertConfigPathNotSymlink(paths.configDir, 'Hydraz config directory');
  mkdirSync(paths.configDir, { recursive: true, mode: 0o700 });

  assertConfigPathNotSymlink(paths.configFile, 'config.json');
  if (!configExists(configDir)) {
    saveConfig(createDefaultConfig(), configDir);
  }
}
