import { execFileSync, spawn } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionMetadata } from '../../core/sessions/index.js';
import {
  formatStoppedWorkspaceNotice,
  getSessionWorkspaceHealth,
} from '../workspace-health.js';
import { buildTailEventsCommand, renderAttachView } from './attach.js';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: vi.fn(() => ({ on: vi.fn() })),
  };
});

vi.mock('../../core/events/index.js', () => ({
  readEvents: vi.fn(() => []),
  formatEvent: vi.fn(),
}));

vi.mock('../workspace-health.js', () => ({
  getSessionWorkspaceHealth: vi.fn(),
  formatStoppedWorkspaceNotice: vi.fn(),
}));

function parseAsPosixShell(command: string): void {
  execFileSync('/bin/sh', ['-n'], { input: command, stdio: 'pipe' });
}

describe('attach command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('[shell regression] quotes spaces and apostrophes in a valid POSIX shell program', () => {
    const eventsPath = "/tmp/hydraz events/it's/events.jsonl";
    const command = buildTailEventsCommand(eventsPath);

    expect(command).toBe("tail -f '/tmp/hydraz events/it'\\''s/events.jsonl'");
    expect(() => parseAsPosixShell(command)).not.toThrow();
  });

  it('[shell regression] quotes shell metacharacters in a valid POSIX shell program', () => {
    const eventsPath = '/tmp/events;$(not-run)|`also-not-run`.jsonl';
    const command = buildTailEventsCommand(eventsPath);

    expect(command).toBe("tail -f '/tmp/events;$(not-run)|`also-not-run`.jsonl'");
    expect(() => parseAsPosixShell(command)).not.toThrow();
  });

  it('reports a stopped workspace instead of spawning SSH', () => {
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
    vi.mocked(getSessionWorkspaceHealth).mockReturnValue({
      workspaceName: 'hydraz-session-1',
      status: 'Stopped',
    });
    vi.mocked(formatStoppedWorkspaceNotice).mockReturnValue(
      'Workspace stopped before Hydraz received a runner result. Restart it with: devpod up hydraz-session-1',
    );
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    renderAttachView(session, '/repo');

    expect(spawn).not.toHaveBeenCalled();
    expect(log.mock.calls.flat().join('\n')).toContain('devpod up hydraz-session-1');
  });
});
