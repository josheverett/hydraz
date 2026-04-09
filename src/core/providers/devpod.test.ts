import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import {
  checkDevPodAvailability,
  checkDockerAvailability,
  hasDevcontainerJson,
  buildSshCommand,
  verifyBranchPushed,
  verifyClaudeInContainer,
  sshExec,
  createWorktreeInContainer,
  copyWorktreeIncludesInContainer,
  scpToContainer,
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

describe('verifyBranchPushed', () => {
  it('returns true when branch exists on remote', () => {
    mockExecFileSync.mockReturnValue('abc123def456\trefs/heads/hydraz/fix-bug\n' as never);
    expect(verifyBranchPushed('my-ws', '/tmp/hydraz-worktrees/s1', 'hydraz/fix-bug')).toBe(true);
  });

  it('returns false when branch does not exist on remote', () => {
    mockExecFileSync.mockReturnValue('' as never);
    expect(verifyBranchPushed('my-ws', '/tmp/hydraz-worktrees/s1', 'hydraz/fix-bug')).toBe(false);
  });

  it('returns false when SSH connection fails', () => {
    mockExecFileSync.mockImplementation(() => { throw new Error('ssh: connect to host failed'); });
    expect(verifyBranchPushed('my-ws', '/tmp/hydraz-worktrees/s1', 'hydraz/fix-bug')).toBe(false);
  });

  it('runs git ls-remote via SSH targeting the correct branch', () => {
    mockExecFileSync.mockReturnValue('' as never);
    verifyBranchPushed('my-ws', '/tmp/hydraz-worktrees/s1', 'hydraz/fix-bug');
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'ssh',
      ['my-ws.devpod', expect.stringContaining("git ls-remote --heads origin 'hydraz/fix-bug'")],
      expect.any(Object),
    );
  });

  it('executes from the worktree path inside the container', () => {
    mockExecFileSync.mockReturnValue('' as never);
    verifyBranchPushed('my-ws', '/tmp/hydraz-worktrees/session-abc', 'hydraz/test');
    const command = mockExecFileSync.mock.calls[0]?.[1]?.[1] as string;
    expect(command).toContain("cd '/tmp/hydraz-worktrees/session-abc'");
  });

  it('returns false on whitespace-only output', () => {
    mockExecFileSync.mockReturnValue('  \n  \n' as never);
    expect(verifyBranchPushed('my-ws', '/tmp/hydraz-worktrees/s1', 'hydraz/fix-bug')).toBe(false);
  });
});

describe('verifyClaudeInContainer', () => {
  it('returns available when claude responds inside the container', () => {
    mockExecFileSync.mockReturnValue('Claude Code v2.1.74\n' as never);
    const result = verifyClaudeInContainer('my-workspace');
    expect(result.available).toBe(true);
    expect(result.version).toContain('2.1.74');
  });

  it('returns unavailable when claude is not found in the container', () => {
    mockExecFileSync.mockImplementation(() => { throw new Error('command not found'); });
    const result = verifyClaudeInContainer('my-workspace');
    expect(result.available).toBe(false);
    expect(result.error).toContain('Claude Code');
    expect(result.error).toContain('container');
  });

  it('calls ssh with the correct workspace name and claude --version', () => {
    mockExecFileSync.mockReturnValue('Claude Code v2.1.74\n' as never);
    verifyClaudeInContainer('hydraz-abc123');
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'ssh',
      ['hydraz-abc123.devpod', 'claude --version'],
      expect.any(Object),
    );
  });
});

describe('sshExec', () => {
  it('executes a command inside the container via SSH', () => {
    mockExecFileSync.mockReturnValue('' as never);
    sshExec('my-workspace', 'echo hello');
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'ssh',
      ['my-workspace.devpod', 'echo hello'],
      expect.any(Object),
    );
  });

  it('returns the command output', () => {
    mockExecFileSync.mockReturnValue('hello\n' as never);
    const output = sshExec('my-workspace', 'echo hello');
    expect(output).toBe('hello\n');
  });

  it('throws on failure', () => {
    mockExecFileSync.mockImplementation(() => { throw new Error('connection refused'); });
    expect(() => sshExec('my-workspace', 'echo hello')).toThrow('connection refused');
  });
});

describe('createWorktreeInContainer', () => {
  it('runs git worktree add via SSH with the correct branch and path', () => {
    mockExecFileSync.mockReturnValue('' as never);
    createWorktreeInContainer('my-ws', '/workspaces/my-ws', 'hydraz/fix-bug', 'session-123');
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'ssh',
      ['my-ws.devpod', expect.stringContaining('git worktree add')],
      expect.any(Object),
    );
  });

  it('includes the branch name in the command', () => {
    mockExecFileSync.mockReturnValue('' as never);
    createWorktreeInContainer('my-ws', '/workspaces/my-ws', 'hydraz/fix-bug', 'session-123');
    const command = mockExecFileSync.mock.calls[0]?.[1]?.[1] as string;
    expect(command).toContain('hydraz/fix-bug');
  });

  it('returns the container-internal worktree path', () => {
    mockExecFileSync.mockReturnValue('' as never);
    const result = createWorktreeInContainer('my-ws', '/workspaces/my-ws', 'hydraz/fix-bug', 'session-123');
    expect(result).toContain('session-123');
  });

  it('creates worktree outside the mounted repo root to avoid host pollution', () => {
    mockExecFileSync.mockReturnValue('' as never);
    const result = createWorktreeInContainer('my-ws', '/workspaces/my-ws', 'hydraz/fix-bug', 'session-123');
    expect(result).not.toContain('/workspaces/my-ws');
    expect(result).toMatch(/^\/tmp\/hydraz-worktrees\//);
  });
});

describe('copyWorktreeIncludesInContainer', () => {
  it('runs the copy command via SSH for provided safe files', () => {
    mockExecFileSync.mockReturnValue('' as never);
    copyWorktreeIncludesInContainer(
      'my-ws',
      '/workspaces/my-ws',
      '/workspaces/my-ws/worktrees/s1',
      ['agent/.env', 'deep/nested/.env'],
    );
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'ssh',
      ['my-ws.devpod', expect.stringContaining("cp 'agent/.env'")],
      expect.any(Object),
    );
  });

  it('does not invoke SSH when there are no files to copy', () => {
    mockExecFileSync.mockReturnValue('' as never);
    expect(() => copyWorktreeIncludesInContainer('my-ws', '/ws', '/ws/wt', [])).not.toThrow();
    expect(mockExecFileSync).not.toHaveBeenCalled();
  });
});

describe('scpToContainer', () => {
  it('calls scp with recursive flag and correct source and destination', () => {
    mockExecFileSync.mockReturnValue('' as never);
    scpToContainer('my-ws', '/local/dist', '/tmp/hydraz-dist');
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'scp',
      expect.arrayContaining(['-r', '/local/dist', 'my-ws.devpod:/tmp/hydraz-dist']),
      expect.any(Object),
    );
  });

  it('targets the correct devpod SSH host in the destination', () => {
    mockExecFileSync.mockReturnValue('' as never);
    scpToContainer('hydraz-abc123', '/dist', '/tmp/hydraz-dist');
    const args = mockExecFileSync.mock.calls[0]?.[1] as string[];
    const dest = args.find(a => a.includes('.devpod:'));
    expect(dest).toBe('hydraz-abc123.devpod:/tmp/hydraz-dist');
  });

  it('throws when scp fails', () => {
    mockExecFileSync.mockImplementation(() => { throw new Error('scp: connection refused'); });
    expect(() => scpToContainer('my-ws', '/dist', '/tmp/hydraz-dist')).toThrow('scp: connection refused');
  });
});
