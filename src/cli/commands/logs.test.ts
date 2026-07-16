import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { detectRepo } from '../../core/repo/detect.js';
import { sshExec } from '../../core/providers/devpod.js';
import { findSessionByName, type SessionMetadata } from '../../core/sessions/index.js';
import { refreshSessionStatus } from '../../core/orchestration/index.js';
import {
  formatStoppedWorkspaceNotice,
  getSessionWorkspaceHealth,
} from '../workspace-health.js';
import { registerLogsCommand } from './logs.js';

vi.mock('../../core/repo/detect.js', () => ({
  detectRepo: vi.fn(),
}));

vi.mock('../../core/providers/devpod.js', () => ({
  sshExec: vi.fn(),
}));

vi.mock('../../core/sessions/index.js', () => ({
  findSessionByName: vi.fn(),
}));

vi.mock('../../core/orchestration/index.js', () => ({
  refreshSessionStatus: vi.fn(),
}));

vi.mock('../workspace-health.js', () => ({
  getSessionWorkspaceHealth: vi.fn(),
  formatStoppedWorkspaceNotice: vi.fn(),
}));

const session: SessionMetadata = {
  id: 'session-1',
  name: 'demo',
  repoRoot: '/repo',
  branchName: 'hydraz/demo',
  executionTarget: 'cloud',
  task: 'Do it',
  state: 'syncing',
  createdAt: '2026-07-16T00:00:00.000Z',
  updatedAt: '2026-07-16T00:00:00.000Z',
  codex: { eventsPath: '/tmp/events.jsonl' },
};

function makeProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerLogsCommand(program);
  return program;
}

describe('logs command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(detectRepo).mockReturnValue({ root: '/repo', name: 'repo' });
    vi.mocked(findSessionByName).mockReturnValue(session);
    vi.mocked(refreshSessionStatus).mockReturnValue(session);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports a stopped workspace instead of reading remote logs', async () => {
    vi.mocked(getSessionWorkspaceHealth).mockReturnValue({
      workspaceName: 'hydraz-session-1',
      status: 'Stopped',
    });
    vi.mocked(formatStoppedWorkspaceNotice).mockReturnValue(
      'Workspace stopped before Hydraz received a runner result. Restart it with: devpod up hydraz-session-1',
    );

    await makeProgram().parseAsync(['node', 'hydraz', 'logs', 'demo']);

    expect(sshExec).not.toHaveBeenCalled();
    expect(vi.mocked(console.log).mock.calls.flat().join('\n')).toContain(
      'devpod up hydraz-session-1',
    );
  });
});
