import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import {
  loadGlobalMcpConfig,
  saveGlobalMcpConfig,
  loadRepoMcpConfig,
  saveRepoMcpConfig,
  mergeScopes,
  getEffectiveServers,
} from './manager.js';
import { addServer, createDefaultMcpConfig, type McpConfig } from './schema.js';
import { initializeConfigDir } from '../config/init.js';
import { initRepoState } from '../sessions/manager.js';

let configDir: string;
let repoRoot: string;

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), 'hydraz-mcp-config-'));
  repoRoot = mkdtempSync(join(tmpdir(), 'hydraz-mcp-repo-'));
  initializeConfigDir(configDir);
  initRepoState(repoRoot);
});

afterEach(() => {
  rmSync(configDir, { recursive: true, force: true });
  rmSync(repoRoot, { recursive: true, force: true });
});

describe('global MCP config', () => {
  it('loads default when no config exists', () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'hydraz-mcp-empty-'));
    const config = loadGlobalMcpConfig(emptyDir);
    expect(config.servers).toEqual([]);
    rmSync(emptyDir, { recursive: true, force: true });
  });

  it('round-trips a config with servers', () => {
    let config = loadGlobalMcpConfig(configDir);
    config = addServer(config, { name: 'github', command: 'npx', enabled: true });
    saveGlobalMcpConfig(config, configDir);

    const reloaded = loadGlobalMcpConfig(configDir);
    expect(reloaded.servers).toHaveLength(1);
    expect(reloaded.servers[0].name).toBe('github');
  });
});

describe('repo MCP config', () => {
  it('loads empty default for repo without MCP config', () => {
    const config = loadRepoMcpConfig(repoRoot);
    expect(config.servers).toEqual([]);
  });

  it('round-trips a repo MCP config', () => {
    let config = loadRepoMcpConfig(repoRoot);
    config = addServer(config, { name: 'postgres', command: 'pg-mcp', enabled: true });
    saveRepoMcpConfig(repoRoot, config);

    const reloaded = loadRepoMcpConfig(repoRoot);
    expect(reloaded.servers).toHaveLength(1);
    expect(reloaded.servers[0].name).toBe('postgres');
  });
});

describe('mergeScopes', () => {
  it('combines global and repo servers', () => {
    const global: McpConfig = {
      servers: [{ name: 'github', command: 'npx', enabled: true }],
    };
    const repo: McpConfig = {
      servers: [{ name: 'postgres', command: 'pg-mcp', enabled: true }],
    };
    const merged = mergeScopes(global, repo);
    expect(merged.servers).toHaveLength(2);
  });

  it('repo overrides global for same-named server', () => {
    const global: McpConfig = {
      servers: [{ name: 'github', command: 'npx', enabled: true }],
    };
    const repo: McpConfig = {
      servers: [{ name: 'github', command: 'custom-github', enabled: false }],
    };
    const merged = mergeScopes(global, repo);
    expect(merged.servers).toHaveLength(1);
    expect(merged.servers[0].command).toBe('custom-github');
    expect(merged.servers[0].enabled).toBe(false);
  });
});

describe('getEffectiveServers', () => {
  it('returns global config when no repo root', () => {
    let config = loadGlobalMcpConfig(configDir);
    config = addServer(config, { name: 'linear', command: 'npx', enabled: true });
    saveGlobalMcpConfig(config, configDir);

    const effective = getEffectiveServers(configDir);
    expect(effective.servers).toHaveLength(1);
  });

  it('merges global and repo when repo root provided', () => {
    let globalConfig = loadGlobalMcpConfig(configDir);
    globalConfig = addServer(globalConfig, { name: 'github', command: 'npx', enabled: true });
    saveGlobalMcpConfig(globalConfig, configDir);

    let repoConfig = loadRepoMcpConfig(repoRoot);
    repoConfig = addServer(repoConfig, { name: 'postgres', command: 'pg', enabled: true });
    saveRepoMcpConfig(repoRoot, repoConfig);

    const effective = getEffectiveServers(configDir, repoRoot);
    expect(effective.servers).toHaveLength(2);
  });
});
