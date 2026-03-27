import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import {
  getDefaultMasterPrompt,
  loadMasterPrompt,
  saveMasterPrompt,
  resetMasterPrompt,
} from './master-prompt.js';
import { resolveConfigPaths } from './paths.js';

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'hydraz-prompt-test-'));
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe('getDefaultMasterPrompt', () => {
  it('returns a non-empty string', () => {
    const prompt = getDefaultMasterPrompt();
    expect(prompt.length).toBeGreaterThan(100);
  });

  it('contains key structural elements', () => {
    const prompt = getDefaultMasterPrompt();
    expect(prompt).toContain('Swarm Structure');
    expect(prompt).toContain('Workflow Phases');
    expect(prompt).toContain('Stopping Conditions');
    expect(prompt).toContain('Artifacts');
  });
});

describe('loadMasterPrompt', () => {
  it('returns the default when no file exists', () => {
    const prompt = loadMasterPrompt(testDir);
    expect(prompt).toBe(getDefaultMasterPrompt());
  });

  it('returns custom content when file exists', () => {
    writeFileSync(join(testDir, 'master-prompt.md'), 'Custom prompt content');
    const prompt = loadMasterPrompt(testDir);
    expect(prompt).toBe('Custom prompt content');
  });
});

describe('saveMasterPrompt', () => {
  it('persists content that can be loaded back', () => {
    saveMasterPrompt('My custom prompt', testDir);
    const loaded = loadMasterPrompt(testDir);
    expect(loaded).toBe('My custom prompt');
  });

  it('writes the file with restrictive permissions on POSIX', () => {
    if (process.platform === 'win32') return;
    saveMasterPrompt('Locked-down prompt', testDir);
    const paths = resolveConfigPaths(testDir);
    expect(statSync(paths.masterPromptFile).mode & 0o777).toBe(0o600);
  });
});

describe('resetMasterPrompt', () => {
  it('restores the default prompt after customization', () => {
    saveMasterPrompt('Something custom', testDir);
    expect(loadMasterPrompt(testDir)).toBe('Something custom');

    resetMasterPrompt(testDir);
    expect(loadMasterPrompt(testDir)).toBe(getDefaultMasterPrompt());
  });
});
