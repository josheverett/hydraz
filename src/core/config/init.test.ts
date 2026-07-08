import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { initializeConfigDir } from './init.js';
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
  });

  it('creates config.json with defaults', () => {
    initializeConfigDir(testDir);
    const paths = resolveConfigPaths(testDir);

    expect(existsSync(paths.configFile)).toBe(true);
    const raw = readFileSync(paths.configFile, 'utf-8');
    const config = JSON.parse(raw);
    expect(config.executionTarget).toBe('cloud');
    expect(config.codex.sandbox).toBe('workspace-write');
  });

  it('creates sensitive config files with restrictive permissions on POSIX', () => {
    if (process.platform === 'win32') return;
    initializeConfigDir(testDir);
    const paths = resolveConfigPaths(testDir);
    expect(statSync(paths.configFile).mode & 0o777).toBe(0o600);
  });

  it('creates config directories with restrictive permissions on POSIX', () => {
    if (process.platform === 'win32') return;
    initializeConfigDir(testDir);
    const paths = resolveConfigPaths(testDir);
    expect(statSync(paths.configDir).mode & 0o777).toBe(0o700);
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

});
