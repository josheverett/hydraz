import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolveConfigPaths } from './paths.js';
import { createDefaultConfig, validateConfig, type HydrazConfig } from './schema.js';

export function configExists(configDir?: string): boolean {
  const paths = resolveConfigPaths(configDir);
  return existsSync(paths.configFile);
}

export function loadConfig(configDir?: string): HydrazConfig {
  const paths = resolveConfigPaths(configDir);

  if (!existsSync(paths.configFile)) {
    return createDefaultConfig();
  }

  const raw = readFileSync(paths.configFile, 'utf-8');
  const data = JSON.parse(raw) as unknown;
  return validateConfig(data);
}

export function saveConfig(config: HydrazConfig, configDir?: string): void {
  const paths = resolveConfigPaths(configDir);
  mkdirSync(paths.configDir, { recursive: true, mode: 0o700 });
  writeFileSync(paths.configFile, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
}
