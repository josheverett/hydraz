import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';
import { registerSandboxCommand } from './sandbox.js';

vi.mock('../../core/repo/detect.js', () => ({
  detectRepo: vi.fn(),
}));

vi.mock('../../core/orchestration/sandbox.js', () => ({
  runSandbox: vi.fn(),
}));

vi.mock('../../core/debug.js', () => ({
  setVerbose: vi.fn(),
  debug: vi.fn(),
  isVerbose: vi.fn(() => false),
}));

import { detectRepo } from '../../core/repo/detect.js';
import { runSandbox } from '../../core/orchestration/sandbox.js';
import { setVerbose } from '../../core/debug.js';

const mockDetectRepo = vi.mocked(detectRepo);
const mockRunSandbox = vi.mocked(runSandbox);
const mockSetVerbose = vi.mocked(setVerbose);

beforeEach(() => {
  vi.clearAllMocks();
  process.exitCode = undefined;
});

function buildProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerSandboxCommand(program);
  return program;
}

async function run(args: string[]): Promise<void> {
  const program = buildProgram();
  await program.parseAsync(['node', 'hydraz', ...args]);
}

describe('registerSandboxCommand', () => {
  it('registers a command named sandbox', () => {
    const program = buildProgram();
    const cmd = program.commands.find((c) => c.name() === 'sandbox');
    expect(cmd).toBeDefined();
    expect(cmd!.description()).toBeTruthy();
  });

  it('has --container and --cloud options', () => {
    const program = buildProgram();
    const cmd = program.commands.find((c) => c.name() === 'sandbox')!;
    const optionNames = cmd.options.map((o) => o.long);
    expect(optionNames).toContain('--container');
    expect(optionNames).toContain('--cloud');
  });

  it('has --verbose, --no-cleanup, and --branch options', () => {
    const program = buildProgram();
    const cmd = program.commands.find((c) => c.name() === 'sandbox')!;
    const optionNames = cmd.options.map((o) => o.long);
    expect(optionNames).toContain('--verbose');
    expect(optionNames).toContain('--no-cleanup');
    expect(optionNames).toContain('--branch');
  });

  it('errors when neither --container nor --cloud is provided', async () => {
    mockDetectRepo.mockReturnValue({ root: '/test/repo', name: 'test-repo' });

    await run(['sandbox']);

    expect(process.exitCode).toBe(1);
    expect(mockRunSandbox).not.toHaveBeenCalled();
  });

  it('calls runSandbox with local-container when --container is provided', async () => {
    mockDetectRepo.mockReturnValue({ root: '/test/repo', name: 'test-repo' });
    mockRunSandbox.mockResolvedValue({ entered: true, steps: [], workspaceName: 'hydraz-abc' });

    await run(['sandbox', '--container']);

    expect(mockRunSandbox).toHaveBeenCalledWith(
      expect.objectContaining({
        executionTarget: 'local-container',
        repoRoot: '/test/repo',
        cleanup: true,
      }),
    );
  });

  it('calls runSandbox with cloud when --cloud is provided', async () => {
    mockDetectRepo.mockReturnValue({ root: '/test/repo', name: 'test-repo' });
    mockRunSandbox.mockResolvedValue({ entered: true, steps: [], workspaceName: 'hydraz-abc' });

    await run(['sandbox', '--cloud']);

    expect(mockRunSandbox).toHaveBeenCalledWith(
      expect.objectContaining({
        executionTarget: 'cloud',
      }),
    );
  });

  it('passes cleanup: false when --no-cleanup is provided', async () => {
    mockDetectRepo.mockReturnValue({ root: '/test/repo', name: 'test-repo' });
    mockRunSandbox.mockResolvedValue({ entered: true, steps: [], workspaceName: 'hydraz-abc' });

    await run(['sandbox', '--container', '--no-cleanup']);

    expect(mockRunSandbox).toHaveBeenCalledWith(
      expect.objectContaining({
        cleanup: false,
      }),
    );
  });

  it('sets verbose when --verbose is provided', async () => {
    mockDetectRepo.mockReturnValue({ root: '/test/repo', name: 'test-repo' });
    mockRunSandbox.mockResolvedValue({ entered: true, steps: [] });

    await run(['sandbox', '--container', '--verbose']);

    expect(mockSetVerbose).toHaveBeenCalledWith(true);
  });

  it('passes branchOverride when --branch is provided', async () => {
    mockDetectRepo.mockReturnValue({ root: '/test/repo', name: 'test-repo' });
    mockRunSandbox.mockResolvedValue({ entered: true, steps: [] });

    await run(['sandbox', '--container', '--branch', 'feature/test']);

    expect(mockRunSandbox).toHaveBeenCalledWith(
      expect.objectContaining({
        branchOverride: 'feature/test',
      }),
    );
  });

  it('sets process.exitCode to 1 when sandbox fails', async () => {
    mockDetectRepo.mockReturnValue({ root: '/test/repo', name: 'test-repo' });
    mockRunSandbox.mockResolvedValue({ entered: false, steps: [] });

    await run(['sandbox', '--container']);

    expect(process.exitCode).toBe(1);
  });

  it('does not call runSandbox when not in a git repo', async () => {
    mockDetectRepo.mockReturnValue(null);

    await run(['sandbox', '--container']);

    expect(mockRunSandbox).not.toHaveBeenCalled();
  });
});
