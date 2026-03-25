import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import {
  checkDevPodAvailability,
  checkDockerAvailability,
  hasDevcontainerJson,
  buildSshCommand,
} from './devpod.js';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

import { execFileSync } from 'node:child_process';
const mockExecFileSync = vi.mocked(execFileSync);

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'hydraz-devpod-test-'));
  vi.clearAllMocks();
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe('checkDevPodAvailability', () => {
  it('returns available with version when devpod is found', () => {
    mockExecFileSync.mockReturnValue('v0.6.15' as never);
    const result = checkDevPodAvailability();
    expect(result.available).toBe(true);
    expect(result.version).toBe('v0.6.15');
  });

  it('returns unavailable when devpod is not found', () => {
    mockExecFileSync.mockImplementation(() => { throw new Error('not found'); });
    const result = checkDevPodAvailability();
    expect(result.available).toBe(false);
    expect(result.error).toContain('DevPod CLI');
  });
});

describe('checkDockerAvailability', () => {
  it('returns true when docker is available', () => {
    mockExecFileSync.mockReturnValue('' as never);
    expect(checkDockerAvailability()).toBe(true);
  });

  it('returns false when docker is not available', () => {
    mockExecFileSync.mockImplementation(() => { throw new Error('not found'); });
    expect(checkDockerAvailability()).toBe(false);
  });
});

describe('hasDevcontainerJson', () => {
  it('returns true when devcontainer.json exists', () => {
    mkdirSync(join(testDir, '.devcontainer'), { recursive: true });
    writeFileSync(join(testDir, '.devcontainer', 'devcontainer.json'), '{}');
    expect(hasDevcontainerJson(testDir)).toBe(true);
  });

  it('returns false when devcontainer.json is missing', () => {
    expect(hasDevcontainerJson(testDir)).toBe(false);
  });

  it('returns false when .devcontainer dir exists but no json', () => {
    mkdirSync(join(testDir, '.devcontainer'), { recursive: true });
    expect(hasDevcontainerJson(testDir)).toBe(false);
  });
});

describe('buildSshCommand', () => {
  it('builds correct ssh command structure', () => {
    const result = buildSshCommand('my-workspace', 'echo hello');
    expect(result.cmd).toBe('ssh');
    expect(result.args).toEqual(['my-workspace.devpod', 'echo hello']);
  });

  it('handles complex commands', () => {
    const result = buildSshCommand('ws', 'claude --print --output-format stream-json "do stuff"');
    expect(result.args[0]).toBe('ws.devpod');
    expect(result.args[1]).toContain('claude');
  });
});
