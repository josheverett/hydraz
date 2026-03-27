import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { initializeConfigDir } from './init.js';
import { BUILT_IN_PERSONAS } from './schema.js';
import { resolveConfigPaths } from './paths.js';

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'hydraz-init-test-'));
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe('initializeConfigDir', () => {
  it('creates the config directory structure', () => {
    initializeConfigDir(testDir);
    const paths = resolveConfigPaths(testDir);

    expect(existsSync(paths.configDir)).toBe(true);
    expect(existsSync(paths.personasDir)).toBe(true);
    expect(existsSync(paths.mcpDir)).toBe(true);
  });

  it('creates config.json with defaults', () => {
    initializeConfigDir(testDir);
    const paths = resolveConfigPaths(testDir);

    expect(existsSync(paths.configFile)).toBe(true);
    const raw = readFileSync(paths.configFile, 'utf-8');
    const config = JSON.parse(raw);
    expect(config.version).toBe('1');
    expect(config.executionTarget).toBe('local');
  });

  it('creates master-prompt.md', () => {
    initializeConfigDir(testDir);
    const paths = resolveConfigPaths(testDir);

    expect(existsSync(paths.masterPromptFile)).toBe(true);
    const content = readFileSync(paths.masterPromptFile, 'utf-8');
    expect(content).toContain('Hydraz Swarm System Prompt');
  });

  it('creates MCP servers.json', () => {
    initializeConfigDir(testDir);
    const paths = resolveConfigPaths(testDir);

    expect(existsSync(paths.mcpServersFile)).toBe(true);
    const raw = readFileSync(paths.mcpServersFile, 'utf-8');
    const data = JSON.parse(raw);
    expect(data.servers).toEqual([]);
  });

  it('seeds all built-in persona files', () => {
    initializeConfigDir(testDir);
    const paths = resolveConfigPaths(testDir);

    for (const name of BUILT_IN_PERSONAS) {
      const personaFile = join(paths.personasDir, `${name}.md`);
      expect(existsSync(personaFile), `missing persona: ${name}`).toBe(true);
    }
  });

  it('creates sensitive config files with restrictive permissions on POSIX', () => {
    if (process.platform === 'win32') return;
    initializeConfigDir(testDir);
    const paths = resolveConfigPaths(testDir);
    expect(statSync(paths.configFile).mode & 0o777).toBe(0o600);
    expect(statSync(paths.masterPromptFile).mode & 0o777).toBe(0o600);
    expect(statSync(paths.mcpServersFile).mode & 0o777).toBe(0o600);
    expect(statSync(join(paths.personasDir, 'architect.md')).mode & 0o777).toBe(0o600);
  });

  it('creates config directories with restrictive permissions on POSIX', () => {
    if (process.platform === 'win32') return;
    initializeConfigDir(testDir);
    const paths = resolveConfigPaths(testDir);
    expect(statSync(paths.configDir).mode & 0o777).toBe(0o700);
    expect(statSync(paths.personasDir).mode & 0o777).toBe(0o700);
    expect(statSync(paths.mcpDir).mode & 0o777).toBe(0o700);
  });

  it('does not overwrite existing config on re-init', () => {
    initializeConfigDir(testDir);
    const paths = resolveConfigPaths(testDir);

    const raw = readFileSync(paths.configFile, 'utf-8');
    const config = JSON.parse(raw);
    config.executionTarget = 'cloud';
    writeFileSync(paths.configFile, JSON.stringify(config, null, 2));

    initializeConfigDir(testDir);

    const reloaded = JSON.parse(readFileSync(paths.configFile, 'utf-8'));
    expect(reloaded.executionTarget).toBe('cloud');
  });

  it('does not overwrite existing persona files', () => {
    initializeConfigDir(testDir);
    const paths = resolveConfigPaths(testDir);

    const architectFile = join(paths.personasDir, 'architect.md');
    writeFileSync(architectFile, 'Custom architect content');

    initializeConfigDir(testDir);

    const content = readFileSync(architectFile, 'utf-8');
    expect(content).toBe('Custom architect content');
  });

  it('rejects a symlinked personas directory during initialization', () => {
    if (process.platform === 'win32') return;
    const paths = resolveConfigPaths(testDir);
    const outside = mkdtempSync(join(tmpdir(), 'hydraz-init-personas-out-'));
    symlinkSync(outside, paths.personasDir);

    try {
      expect(() => initializeConfigDir(testDir)).toThrow(/symlink/i);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
