import { homedir } from 'node:os';
import { join } from 'node:path';

export interface ConfigPaths {
  configDir: string;
  configFile: string;
  masterPromptFile: string;
  personasDir: string;
  mcpDir: string;
  mcpServersFile: string;
}

export function resolveConfigPaths(overrideDir?: string): ConfigPaths {
  const configDir = overrideDir ?? join(homedir(), '.config', 'hydraz');

  return {
    configDir,
    configFile: join(configDir, 'config.json'),
    masterPromptFile: join(configDir, 'master-prompt.md'),
    personasDir: join(configDir, 'personas'),
    mcpDir: join(configDir, 'mcp'),
    mcpServersFile: join(configDir, 'mcp', 'servers.json'),
  };
}
