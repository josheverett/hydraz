import { mkdtempSync, rmSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { loadConfig, saveConfig, configExists } from './loader.js';
import { createDefaultConfig } from './schema.js';

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'hydraz-loader-test-'));
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe('configExists', () => {
  it('returns false when config directory is empty', () => {
    expect(configExists(testDir)).toBe(false);
  });

  it('returns true after saving a config', () => {
    saveConfig(createDefaultConfig(), testDir);
    expect(configExists(testDir)).toBe(true);
  });
});

describe('loadConfig', () => {
  it('returns defaults when no config file exists', () => {
    const config = loadConfig(testDir);
    expect(config).toEqual(createDefaultConfig());
  });

  it('loads a previously saved config', () => {
    const original = createDefaultConfig();
    original.executionTarget = 'cloud';
    saveConfig(original, testDir);

    const loaded = loadConfig(testDir);
    expect(loaded.executionTarget).toBe('cloud');
  });

  it('rejects symlinked config.json files', () => {
    if (process.platform === 'win32') return;
    const outside = mkdtempSync(join(tmpdir(), 'hydraz-config-out-'));
    writeFileSync(join(outside, 'config.json'), JSON.stringify(createDefaultConfig()));
    symlinkSync(join(outside, 'config.json'), join(testDir, 'config.json'));

    try {
      expect(() => loadConfig(testDir)).toThrow(/symlink/i);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe('saveConfig', () => {
  it('creates the config directory if it does not exist', () => {
    const nested = join(testDir, 'deep', 'nested');
    saveConfig(createDefaultConfig(), nested);
    expect(configExists(nested)).toBe(true);
  });

  it('writes valid JSON', () => {
    saveConfig(createDefaultConfig(), testDir);
    const raw = readFileSync(join(testDir, 'config.json'), 'utf-8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it('round-trips a modified config', () => {
    const config = createDefaultConfig();
    config.claudeAuth.mode = 'api-key';
    config.retention.keepTranscripts = true;
    saveConfig(config, testDir);

    const loaded = loadConfig(testDir);
    expect(loaded.claudeAuth.mode).toBe('api-key');
    expect(loaded.retention.keepTranscripts).toBe(true);
  });

  it('sets config file permissions to 0600 (owner-only)', () => {
    saveConfig(createDefaultConfig(), testDir);
    const stats = statSync(join(testDir, 'config.json'));
    const mode = (stats.mode & 0o777).toString(8);
    expect(mode).toBe('600');
  });

  it('refuses to write through a symlinked config.json path', () => {
    if (process.platform === 'win32') return;
    const outside = mkdtempSync(join(tmpdir(), 'hydraz-config-target-'));
    const target = join(outside, 'config.json');
    writeFileSync(target, '{}');
    symlinkSync(target, join(testDir, 'config.json'));

    try {
      expect(() => saveConfig(createDefaultConfig(), testDir)).toThrow(/symlink/i);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
