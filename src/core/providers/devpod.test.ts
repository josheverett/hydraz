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
  scpFilesToContainer,
  getDistRoot,
  devpodUp,
  devpodDelete,
  devpodList,
} from './devpod.js';
import { setVerbose } from '../debug.js';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

import { execFileSync } from 'node:child_process';
const mockExecFileSync = vi.mocked(execFileSync);

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'hydraz-devpod-test-'));
  setVerbose(false);
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

describe('getDistRoot', () => {
  it('returns the directory two levels above the module file (src/ in test, dist/ in production)', () => {
    const root = getDistRoot();
    const basename = root.split('/').pop();
    expect(['src', 'dist']).toContain(basename);
  });

  it('does not return the project root', () => {
    const root = getDistRoot();
    expect(root).not.toMatch(/\/hydraz$/);
    expect(root).not.toContain('node_modules');
  });
});

describe('scpToContainer', () => {
  it('uses tar|ssh pipe via sh -c for efficient transfer', () => {
    mockExecFileSync.mockReturnValue('' as never);
    scpToContainer('my-ws', '/local/dist', '/tmp/hydraz-dist');
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'sh',
      ['-c', expect.stringContaining('tar')],
      expect.any(Object),
    );
  });

  it('pipes tar output to ssh targeting the correct devpod host', () => {
    mockExecFileSync.mockReturnValue('' as never);
    scpToContainer('hydraz-abc123', '/dist', '/tmp/hydraz-dist');
    const cmd = mockExecFileSync.mock.calls[0]?.[1]?.[1] as string;
    expect(cmd).toContain('ssh');
    expect(cmd).toContain('hydraz-abc123.devpod');
  });

  it('includes rm and mkdir in the remote command for idempotent transfer', () => {
    mockExecFileSync.mockReturnValue('' as never);
    scpToContainer('my-ws', '/dist', '/tmp/hydraz-dist');
    const cmd = mockExecFileSync.mock.calls[0]?.[1]?.[1] as string;
    expect(cmd).toContain('rm -rf /tmp/hydraz-dist');
    expect(cmd).toContain('mkdir -p /tmp/hydraz-dist');
  });

  it('writes a package.json with type:module into the remote path for ESM support', () => {
    mockExecFileSync.mockReturnValue('' as never);
    scpToContainer('my-ws', '/dist', '/tmp/hydraz-dist');
    const cmd = mockExecFileSync.mock.calls[0]?.[1]?.[1] as string;
    expect(cmd).toContain('package.json');
    expect(cmd).toContain('"type":"module"');
  });

  it('throws when the transfer fails', () => {
    mockExecFileSync.mockImplementation(() => { throw new Error('ssh: connection refused'); });
    expect(() => scpToContainer('my-ws', '/dist', '/tmp/hydraz-dist')).toThrow('ssh: connection refused');
  });
});

describe('scpFilesToContainer', () => {
  it('uses tar|ssh pipe via sh -c to transfer specific files', () => {
    mockExecFileSync.mockReturnValue('' as never);
    scpFilesToContainer('my-ws', '/host/repo', '/workspaces/my-ws', ['agent/.env']);
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'sh',
      ['-c', expect.stringContaining('tar')],
      expect.any(Object),
    );
  });

  it('includes all specified files in the tar command', () => {
    mockExecFileSync.mockReturnValue('' as never);
    scpFilesToContainer('my-ws', '/host/repo', '/workspaces/my-ws', ['agent/.env', 'deep/nested/.env']);
    const cmd = mockExecFileSync.mock.calls[0]?.[1]?.[1] as string;
    expect(cmd).toContain("'agent/.env'");
    expect(cmd).toContain("'deep/nested/.env'");
  });

  it('extracts into the container repo path', () => {
    mockExecFileSync.mockReturnValue('' as never);
    scpFilesToContainer('my-ws', '/host/repo', '/workspaces/my-ws', ['.env']);
    const cmd = mockExecFileSync.mock.calls[0]?.[1]?.[1] as string;
    expect(cmd).toContain("'/workspaces/my-ws'");
  });

  it('tars from the host repo root directory', () => {
    mockExecFileSync.mockReturnValue('' as never);
    scpFilesToContainer('my-ws', '/host/repo', '/workspaces/my-ws', ['.env']);
    const cmd = mockExecFileSync.mock.calls[0]?.[1]?.[1] as string;
    expect(cmd).toContain("'/host/repo'");
  });

  it('targets the correct devpod host', () => {
    mockExecFileSync.mockReturnValue('' as never);
    scpFilesToContainer('hydraz-abc123', '/host/repo', '/workspaces/hydraz-abc123', ['.env']);
    const cmd = mockExecFileSync.mock.calls[0]?.[1]?.[1] as string;
    expect(cmd).toContain('hydraz-abc123.devpod');
  });

  it('does not invoke any command when there are no files', () => {
    mockExecFileSync.mockReturnValue('' as never);
    scpFilesToContainer('my-ws', '/host/repo', '/workspaces/my-ws', []);
    expect(mockExecFileSync).not.toHaveBeenCalled();
  });

  it('throws when the transfer fails', () => {
    mockExecFileSync.mockImplementation(() => { throw new Error('ssh: connection refused'); });
    expect(() => scpFilesToContainer('my-ws', '/host/repo', '/workspaces/my-ws', ['.env'])).toThrow('ssh: connection refused');
  });
});

describe('devpodUp', () => {
  it('uses a 900 second timeout for first-time devcontainer builds', () => {
    mockExecFileSync.mockReturnValue('' as never);
    devpodUp('git@github.com:org/repo.git', 'hydraz-abc');
    const opts = mockExecFileSync.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(opts.timeout).toBe(900_000);
  });

  it('uses stdio inherit when verbose is enabled for real-time streaming', () => {
    setVerbose(true);
    mockExecFileSync.mockReturnValue('' as never);
    devpodUp('git@github.com:org/repo.git', 'hydraz-abc');
    const opts = mockExecFileSync.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(opts.stdio).toBe('inherit');
  });

  it('uses stdio pipe when verbose is disabled', () => {
    mockExecFileSync.mockReturnValue('' as never);
    devpodUp('git@github.com:org/repo.git', 'hydraz-abc');
    const opts = mockExecFileSync.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(opts.stdio).toBe('pipe');
  });

  it('passes the source and workspace name to devpod up', () => {
    mockExecFileSync.mockReturnValue('' as never);
    devpodUp('git@github.com:org/repo.git', 'hydraz-abc');
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'devpod',
      ['up', 'git@github.com:org/repo.git', '--ide', 'none', '--id', 'hydraz-abc'],
      expect.any(Object),
    );
  });

  it('includes --provider flag when provider is specified', () => {
    mockExecFileSync.mockReturnValue('' as never);
    devpodUp('git@github.com:org/repo.git', 'hydraz-abc', 'docker');
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'devpod',
      ['up', 'git@github.com:org/repo.git', '--ide', 'none', '--id', 'hydraz-abc', '--provider', 'docker'],
      expect.any(Object),
    );
  });

  it('omits --provider flag when provider is not specified', () => {
    mockExecFileSync.mockReturnValue('' as never);
    devpodUp('git@github.com:org/repo.git', 'hydraz-abc');
    const args = mockExecFileSync.mock.calls[0]?.[1] as string[];
    expect(args).not.toContain('--provider');
  });

  it('appends branch to source URL with @ syntax when branch is specified', () => {
    mockExecFileSync.mockReturnValue('' as never);
    devpodUp('git@github.com:org/repo.git', 'hydraz-abc', 'docker', 'feature/devcontainer');
    const args = mockExecFileSync.mock.calls[0]?.[1] as string[];
    expect(args[1]).toBe('git@github.com:org/repo.git@feature/devcontainer');
  });

  it('uses bare source URL when branch is not specified', () => {
    mockExecFileSync.mockReturnValue('' as never);
    devpodUp('git@github.com:org/repo.git', 'hydraz-abc', 'docker');
    const args = mockExecFileSync.mock.calls[0]?.[1] as string[];
    expect(args[1]).toBe('git@github.com:org/repo.git');
  });

  it('passes --debug to devpod when verbose is enabled', () => {
    setVerbose(true);
    mockExecFileSync.mockReturnValue('' as never);
    devpodUp('git@github.com:org/repo.git', 'hydraz-abc');
    const args = mockExecFileSync.mock.calls[0]?.[1] as string[];
    expect(args).toContain('--debug');
  });

  it('omits --debug when verbose is disabled', () => {
    mockExecFileSync.mockReturnValue('' as never);
    devpodUp('git@github.com:org/repo.git', 'hydraz-abc');
    const args = mockExecFileSync.mock.calls[0]?.[1] as string[];
    expect(args).not.toContain('--debug');
  });
});

describe('devpodDelete', () => {
  it('calls devpod delete with the workspace name', () => {
    mockExecFileSync.mockReturnValue('' as never);
    devpodDelete('hydraz-abc123');
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'devpod',
      ['delete', 'hydraz-abc123'],
      expect.any(Object),
    );
  });

  it('passes --force flag when force option is true', () => {
    mockExecFileSync.mockReturnValue('' as never);
    devpodDelete('hydraz-abc123', true);
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'devpod',
      ['delete', '--force', 'hydraz-abc123'],
      expect.any(Object),
    );
  });

  it('omits --force flag when force option is false', () => {
    mockExecFileSync.mockReturnValue('' as never);
    devpodDelete('hydraz-abc123', false);
    const args = mockExecFileSync.mock.calls[0]?.[1] as string[];
    expect(args).not.toContain('--force');
  });

  it('omits --force flag when force option is not provided', () => {
    mockExecFileSync.mockReturnValue('' as never);
    devpodDelete('hydraz-abc123');
    const args = mockExecFileSync.mock.calls[0]?.[1] as string[];
    expect(args).not.toContain('--force');
  });
});

describe('devpodList', () => {
  it('returns parsed workspace entries from devpod list JSON output', () => {
    const jsonOutput = JSON.stringify([
      { id: 'hydraz-abc123', status: 'Running' },
      { id: 'hydraz-def456', status: 'Stopped' },
    ]);
    mockExecFileSync.mockReturnValue(jsonOutput as never);

    const result = devpodList();

    expect(result).toEqual([
      { name: 'hydraz-abc123', status: 'Running' },
      { name: 'hydraz-def456', status: 'Stopped' },
    ]);
  });

  it('calls devpod list with --output json', () => {
    mockExecFileSync.mockReturnValue('[]' as never);
    devpodList();
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'devpod',
      ['list', '--output', 'json'],
      expect.objectContaining({ encoding: 'utf-8' }),
    );
  });

  it('returns empty array when no workspaces exist', () => {
    mockExecFileSync.mockReturnValue('[]' as never);
    const result = devpodList();
    expect(result).toEqual([]);
  });

  it('returns empty array when devpod list fails', () => {
    mockExecFileSync.mockImplementation(() => { throw new Error('devpod not found'); });
    const result = devpodList();
    expect(result).toEqual([]);
  });

  it('returns empty array when output is not valid JSON', () => {
    mockExecFileSync.mockReturnValue('not json' as never);
    const result = devpodList();
    expect(result).toEqual([]);
  });

  it('returns empty array when output is not an array', () => {
    mockExecFileSync.mockReturnValue('{"id": "ws"}' as never);
    const result = devpodList();
    expect(result).toEqual([]);
  });

  it('skips entries without an id field', () => {
    const jsonOutput = JSON.stringify([
      { id: 'hydraz-abc', status: 'Running' },
      { status: 'Stopped' },
      { id: 'hydraz-def', status: 'Running' },
    ]);
    mockExecFileSync.mockReturnValue(jsonOutput as never);

    const result = devpodList();

    expect(result).toHaveLength(2);
    expect(result[0]!.name).toBe('hydraz-abc');
    expect(result[1]!.name).toBe('hydraz-def');
  });

  it('defaults status to Unknown when status field is missing', () => {
    const jsonOutput = JSON.stringify([{ id: 'hydraz-abc' }]);
    mockExecFileSync.mockReturnValue(jsonOutput as never);

    const result = devpodList();

    expect(result).toEqual([{ name: 'hydraz-abc', status: 'Unknown' }]);
  });
});
