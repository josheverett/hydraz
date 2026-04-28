import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveRepoDataPaths } from '../repo/paths.js';
import { initRepoState, createNewSession } from '../sessions/manager.js';
import { createDefaultConfig } from '../config/schema.js';
import { ensureSwarmDirs, getSwarmDir } from './artifacts.js';
import { runReviewPanel } from './reviewer.js';
import { buildReviewerPrompt } from './prompts/reviewer.js';
import type { ExecutionContext } from './types.js';

vi.mock('../claude/executor.js', () => ({ launchClaude: vi.fn() }));
vi.mock('../orchestration/shutdown.js', () => ({
  registerExecutorHandle: vi.fn(),
  unregisterExecutorHandle: vi.fn(),
}));

import { launchClaude } from '../claude/executor.js';
import { registerExecutorHandle, unregisterExecutorHandle } from '../orchestration/shutdown.js';

const mockLaunchClaude = vi.mocked(launchClaude);
const mockRegister = vi.mocked(registerExecutorHandle);
const mockUnregister = vi.mocked(unregisterExecutorHandle);

let repoRoot: string;
let sessionId: string;
let config: ReturnType<typeof createDefaultConfig>;

const DEFAULT_PERSONAS = [
  { name: 'reviewer', persona: 'Review the code for correctness, completeness, and serious defects.' },
];

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), 'hydraz-reviewer-test-'));
  initRepoState(repoRoot);
  const session = createNewSession({ name: 'test-review', repoRoot, branchName: 'hydraz/test-review', personas: ['architect', 'implementer', 'verifier'], executionTarget: 'local', task: 'Build the system' });
  sessionId = session.id;
  config = createDefaultConfig();
  ensureSwarmDirs(repoRoot, sessionId);
});

afterEach(() => { vi.clearAllMocks(); rmSync(repoRoot, { recursive: true, force: true }); const paths = resolveRepoDataPaths(repoRoot); rmSync(paths.repoDataDir, { recursive: true, force: true }); });

function makeCtx(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return { repoRoot, sessionId, sessionName: 'test-review', task: 'Build the system', workingDirectory: repoRoot, config, swarmDir: getSwarmDir(repoRoot, sessionId), ...overrides };
}

function mockAllReviewersSucceed() {
  mockLaunchClaude.mockReturnValue({ process: {} as never, pid: 12345, kill: vi.fn(), waitForExit: vi.fn().mockResolvedValue({ exitCode: 0, signal: null, success: true, cost: 0.20 }) });
}

function mockReviewerFailure() {
  let callIndex = 0;
  mockLaunchClaude.mockImplementation(() => {
    const shouldFail = callIndex === 1; callIndex++;
    return { process: {} as never, pid: 12345, kill: vi.fn(), waitForExit: vi.fn().mockResolvedValue({ exitCode: shouldFail ? 1 : 0, signal: null, success: !shouldFail, cost: 0.20 }) };
  });
}

describe('buildReviewerPrompt', () => {
  it('should include the task description', () => { expect(buildReviewerPrompt('Build auth', 'auth-session', '# Plan', '# Arch', 'Review for correctness.', 'reviewer')).toContain('Build auth'); });
  it('should include the reviewer persona', () => { expect(buildReviewerPrompt('Build auth', 'auth-session', '# Plan', '# Arch', 'Review for correctness.', 'reviewer')).toContain('Review for correctness'); });
  it('should include the reviewer name', () => { expect(buildReviewerPrompt('Build auth', 'auth-session', '# Plan', '# Arch', 'Review for correctness.', 'reviewer')).toContain('reviewer'); });
  it('should include the plan content', () => { expect(buildReviewerPrompt('Build auth', 'auth-session', '# Plan\nDetailed steps.', '# Arch', 'Review for correctness.', 'reviewer')).toContain('Detailed steps'); });
  it('should include the architecture design', () => { expect(buildReviewerPrompt('Build auth', 'auth-session', '# Plan', '# Arch\nMiddleware pattern.', 'Review for correctness.', 'reviewer')).toContain('Middleware pattern'); });
  it('should instruct categorizing findings as architectural or implementation', () => { const p = buildReviewerPrompt('Build auth', 'auth-session', '# Plan', '# Arch', 'Review for correctness.', 'reviewer'); expect(p).toContain('architectural'); expect(p).toContain('implementation'); });
  it('should instruct writing review to reviews/<name>.md', () => { expect(buildReviewerPrompt('Build auth', 'auth-session', '# Plan', '# Arch', 'Review for correctness.', 'reviewer')).toContain('reviewer.md'); });
  it('should include evidence discipline principles', () => { const p = buildReviewerPrompt('Build auth', 'auth-session', '# Plan', '# Arch', 'Review for correctness.', 'reviewer'); expect(p).toContain('Verified facts'); expect(p).toContain('Assumptions'); });
  it('should include the absolute swarm directory path when provided', () => { expect(buildReviewerPrompt('Build auth', 'auth-session', '# Plan', '# Arch', 'Review for correctness.', 'reviewer', '/tmp/swarm')).toContain('/tmp/swarm'); });

  it('should not include persona embodiment language', () => {
    const prompt = buildReviewerPrompt('Build auth', 'auth-session', '# Plan', '# Arch', 'Review for correctness.', 'reviewer');
    expect(prompt).not.toContain('Embody this perspective');
    expect(prompt).not.toContain('ships working code');
  });

  it('should include verdict formatting instructions', () => {
    const prompt = buildReviewerPrompt('Build auth', 'auth-session', '# Plan', '# Arch', 'Review for correctness.', 'reviewer');
    expect(prompt).toContain('no markdown formatting, no headings, no bold, no prefixes');
  });

  it('should include repo prompt content when provided', () => {
    const prompt = buildReviewerPrompt('Build auth', 'auth-session', '# Plan', '# Arch', 'Review for correctness.', 'reviewer', undefined, 'Always read CLAUDE.md files.');
    expect(prompt).toContain('Always read CLAUDE.md files.');
  });

  it('should not include repo-specific section when repoPromptContent is not provided', () => {
    const prompt = buildReviewerPrompt('Build auth', 'auth-session', '# Plan', '# Arch', 'Review for correctness.', 'reviewer');
    expect(prompt).not.toContain('Repo-Specific');
  });
});

describe('runReviewPanel', () => {
  it('should launch claude once per reviewer', async () => {
    mockAllReviewersSucceed();
    await runReviewPanel(makeCtx(), { planContent: '# Plan', architectureDesign: '# Arch', reviewerPersonas: DEFAULT_PERSONAS });
    expect(mockLaunchClaude).toHaveBeenCalledTimes(1);
  });

  it('should return success when all reviewers complete', async () => {
    mockAllReviewersSucceed();
    const result = await runReviewPanel(makeCtx(), { planContent: '# Plan', architectureDesign: '# Arch', reviewerPersonas: DEFAULT_PERSONAS });
    expect(result.success).toBe(true);
    expect(result.reviews).toHaveLength(1);
    expect(result.reviews.every(r => r.success)).toBe(true);
  });

  it('should include reviewer names in results', async () => {
    mockAllReviewersSucceed();
    const result = await runReviewPanel(makeCtx(), { planContent: '# Plan', architectureDesign: '# Arch', reviewerPersonas: DEFAULT_PERSONAS });
    const names = result.reviews.map(r => r.reviewerName);
    expect(names).toEqual(['reviewer']);
  });

  it('should return failure when any reviewer fails', async () => {
    mockLaunchClaude.mockReturnValue({
      process: {} as never, pid: 12345, kill: vi.fn(),
      waitForExit: vi.fn().mockResolvedValue({ exitCode: 1, signal: null, success: false, cost: 0.20 }),
    });
    const result = await runReviewPanel(makeCtx(), { planContent: '# Plan', architectureDesign: '# Arch', reviewerPersonas: DEFAULT_PERSONAS });
    expect(result.success).toBe(false);
    expect(result.reviews.some(r => !r.success)).toBe(true);
  });

  it('should pass reviewer persona content in prompt', async () => {
    mockAllReviewersSucceed();
    await runReviewPanel(makeCtx(), { planContent: '# Plan', architectureDesign: '# Arch', reviewerPersonas: DEFAULT_PERSONAS });
    const prompts = mockLaunchClaude.mock.calls.map(c => c[0]!.prompt);
    expect(prompts[0]).toContain('correctness');
  });

  it('should include repoPromptContent in reviewer prompts when set on context', async () => {
    mockAllReviewersSucceed();
    await runReviewPanel(makeCtx({ repoPromptContent: 'Always read CLAUDE.md files.' }), { planContent: '# Plan', architectureDesign: '# Arch', reviewerPersonas: DEFAULT_PERSONAS });
    const prompts = mockLaunchClaude.mock.calls.map(c => c[0]!.prompt);
    expect(prompts.every(p => p.includes('Always read CLAUDE.md files.'))).toBe(true);
  });

  it('should register and unregister executor handles for all reviewers', async () => {
    mockAllReviewersSucceed();
    await runReviewPanel(makeCtx(), { planContent: '# Plan', architectureDesign: '# Arch', reviewerPersonas: DEFAULT_PERSONAS });

    expect(mockRegister).toHaveBeenCalledTimes(1);
    expect(mockUnregister).toHaveBeenCalledTimes(1);
    const handle = mockLaunchClaude.mock.results[0]!.value;
    expect(mockRegister).toHaveBeenCalledWith(handle);
    expect(mockUnregister).toHaveBeenCalledWith(handle);
  });
});
