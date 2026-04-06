import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { assertConfigPathNotSymlink } from '../config/protected-path.js';
import { resolveConfigPaths } from '../config/paths.js';
import { resolveRepoDataPaths } from '../repo/paths.js';
import { createDefaultMcpConfig, validateMcpConfig, type McpConfig } from './schema.js';

export function loadGlobalMcpConfig(configDir?: string): McpConfig {
  const paths = resolveConfigPaths(configDir);
  assertConfigPathNotSymlink(paths.mcpDir, 'global MCP directory');
  assertConfigPathNotSymlink(paths.mcpServersFile, 'global MCP config');
  if (!existsSync(paths.mcpServersFile)) {
    return createDefaultMcpConfig();
  }
  return validateMcpConfig(JSON.parse(readFileSync(paths.mcpServersFile, 'utf-8')));
}

export function saveGlobalMcpConfig(config: McpConfig, configDir?: string): void {
  const paths = resolveConfigPaths(configDir);
  assertConfigPathNotSymlink(paths.mcpDir, 'global MCP directory');
  mkdirSync(dirname(paths.mcpServersFile), { recursive: true, mode: 0o700 });
  assertConfigPathNotSymlink(paths.mcpServersFile, 'global MCP config');
  writeFileSync(paths.mcpServersFile, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
}

export function loadRepoMcpConfig(repoRoot: string): McpConfig {
  const paths = resolveRepoDataPaths(repoRoot);
  assertConfigPathNotSymlink(dirname(paths.repoMcpFile), 'repo MCP directory');
  assertConfigPathNotSymlink(paths.repoMcpFile, 'repo MCP config');
  if (!existsSync(paths.repoMcpFile)) {
    return createDefaultMcpConfig();
  }
  return validateMcpConfig(JSON.parse(readFileSync(paths.repoMcpFile, 'utf-8')));
}

export function saveRepoMcpConfig(repoRoot: string, config: McpConfig): void {
  const paths = resolveRepoDataPaths(repoRoot);
  assertConfigPathNotSymlink(dirname(paths.repoMcpFile), 'repo MCP directory');
  mkdirSync(dirname(paths.repoMcpFile), { recursive: true, mode: 0o700 });
  assertConfigPathNotSymlink(paths.repoMcpFile, 'repo MCP config');
  writeFileSync(paths.repoMcpFile, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
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
