import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { resolveConfigPaths } from '../config/paths.js';
import { getHydrazDir } from '../sessions/manager.js';
import { createDefaultMcpConfig, type McpConfig } from './schema.js';

export function loadGlobalMcpConfig(configDir?: string): McpConfig {
  const paths = resolveConfigPaths(configDir);
  if (!existsSync(paths.mcpServersFile)) {
    return createDefaultMcpConfig();
  }
  return JSON.parse(readFileSync(paths.mcpServersFile, 'utf-8')) as McpConfig;
}

export function saveGlobalMcpConfig(config: McpConfig, configDir?: string): void {
  const paths = resolveConfigPaths(configDir);
  mkdirSync(dirname(paths.mcpServersFile), { recursive: true });
  writeFileSync(paths.mcpServersFile, JSON.stringify(config, null, 2) + '\n');
}

export function loadRepoMcpConfig(repoRoot: string): McpConfig {
  const repoMcpFile = join(getHydrazDir(repoRoot), 'mcp.json');
  if (!existsSync(repoMcpFile)) {
    return createDefaultMcpConfig();
  }
  return JSON.parse(readFileSync(repoMcpFile, 'utf-8')) as McpConfig;
}

export function saveRepoMcpConfig(repoRoot: string, config: McpConfig): void {
  const hydrazDir = getHydrazDir(repoRoot);
  mkdirSync(hydrazDir, { recursive: true });
  writeFileSync(join(hydrazDir, 'mcp.json'), JSON.stringify(config, null, 2) + '\n');
}

export function mergeScopes(global: McpConfig, repo: McpConfig): McpConfig {
  const merged = new Map<string, McpConfig['servers'][number]>();

  for (const server of global.servers) {
    merged.set(server.name, server);
  }

  for (const server of repo.servers) {
    merged.set(server.name, server);
  }

  return { servers: Array.from(merged.values()) };
}

export function getEffectiveServers(configDir?: string, repoRoot?: string): McpConfig {
  const global = loadGlobalMcpConfig(configDir);
  if (!repoRoot) return global;

  const repo = loadRepoMcpConfig(repoRoot);
  return mergeScopes(global, repo);
}
