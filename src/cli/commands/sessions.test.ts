import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { confirm } from '@inquirer/prompts';
import { detectRepo } from '../../core/repo/detect.js';
import { clearRepoSessions, listSessions } from '../../core/sessions/index.js';
import { registerSessionsCommand } from './sessions.js';

vi.mock('@inquirer/prompts', () => ({
  confirm: vi.fn(),
}));

vi.mock('../../core/repo/detect.js', () => ({
  detectRepo: vi.fn(),
}));

vi.mock('../../core/sessions/index.js', () => ({
  clearRepoSessions: vi.fn(),
  listSessions: vi.fn(),
}));

const session = {
  id: 'session-a',
  name: 'session-a',
  repoRoot: '/repo',
  branchName: 'hydraz/session-a',
  executionTarget: 'local' as const,
  task: 'Do the thing',
  state: 'created' as const,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

function makeProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({
    writeOut: () => {},
    writeErr: () => {},
  });
  registerSessionsCommand(program);
  return program;
}

describe('sessions clear command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(detectRepo).mockReturnValue({ root: '/repo', name: 'repo' });
    vi.mocked(listSessions).mockReturnValue([session]);
    vi.mocked(clearRepoSessions).mockReturnValue({ sessions: 1, workspaces: 0 });
    vi.mocked(confirm).mockReset();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not clear sessions during dry run', async () => {
    const program = makeProgram();

    await program.parseAsync(['node', 'hydraz', 'sessions', 'clear', '--dry-run']);

    expect(clearRepoSessions).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });

  it('does not clear sessions when confirmation is rejected', async () => {
    vi.mocked(confirm).mockResolvedValue(false);
    const program = makeProgram();

    await program.parseAsync(['node', 'hydraz', 'sessions', 'clear']);

    expect(clearRepoSessions).not.toHaveBeenCalled();
  });

  it('clears sessions without prompting when forced', async () => {
    const program = makeProgram();

    await program.parseAsync(['node', 'hydraz', 'sessions', 'clear', '--force']);

    expect(confirm).not.toHaveBeenCalled();
    expect(clearRepoSessions).toHaveBeenCalledWith('/repo');
  });
});
