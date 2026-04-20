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
  { name: 'carmack', persona: 'You are John Carmack. Focus on correctness and edge cases.' },
  { name: 'metz', persona: 'You are Sandi Metz. Focus on design quality and maintainability.' },
  { name: 'torvalds', persona: 'You are Linus Torvalds. Focus on simplicity and rejecting bloat.' },
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
  it('should include the task description', () => { expect(buildReviewerPrompt('Build auth', 'auth-session', '# Plan', '# Arch', 'You are Carmack.', 'carmack')).toContain('Build auth'); });
  it('should include the reviewer persona', () => { expect(buildReviewerPrompt('Build auth', 'auth-session', '# Plan', '# Arch', 'You are Carmack. Focus on correctness.', 'carmack')).toContain('Focus on correctness'); });
  it('should include the reviewer name', () => { expect(buildReviewerPrompt('Build auth', 'auth-session', '# Plan', '# Arch', 'Persona text.', 'carmack')).toContain('carmack'); });
  it('should include the plan content', () => { expect(buildReviewerPrompt('Build auth', 'auth-session', '# Plan\nDetailed steps.', '# Arch', 'Persona.', 'carmack')).toContain('Detailed steps'); });
  it('should include the architecture design', () => { expect(buildReviewerPrompt('Build auth', 'auth-session', '# Plan', '# Arch\nMiddleware pattern.', 'Persona.', 'carmack')).toContain('Middleware pattern'); });
  it('should instruct categorizing findings as architectural or implementation', () => { const p = buildReviewerPrompt('Build auth', 'auth-session', '# Plan', '# Arch', 'Persona.', 'carmack'); expect(p).toContain('architectural'); expect(p).toContain('implementation'); });
  it('should instruct writing review to reviews/<name>.md', () => { expect(buildReviewerPrompt('Build auth', 'auth-session', '# Plan', '# Arch', 'Persona.', 'carmack')).toContain('carmack.md'); });
  it('should include evidence discipline principles', () => { const p = buildReviewerPrompt('Build auth', 'auth-session', '# Plan', '# Arch', 'Persona.', 'carmack'); expect(p).toContain('Verified facts'); expect(p).toContain('Assumptions'); });
  it('should include the absolute swarm directory path when provided', () => { expect(buildReviewerPrompt('Build auth', 'auth-session', '# Plan', '# Arch', 'Persona.', 'carmack', '/tmp/swarm')).toContain('/tmp/swarm'); });

  it('should include repo prompt content when provided', () => {
    const prompt = buildReviewerPrompt('Build auth', 'auth-session', '# Plan', '# Arch', 'Persona.', 'carmack', undefined, 'Always read CLAUDE.md files.');
    expect(prompt).toContain('Always read CLAUDE.md files.');
  });

  it('should not include repo-specific section when repoPromptContent is not provided', () => {
    const prompt = buildReviewerPrompt('Build auth', 'auth-session', '# Plan', '# Arch', 'Persona.', 'carmack');
    expect(prompt).not.toContain('Repo-Specific');
  });
});

describe('runReviewPanel', () => {
  it('should launch claude once per reviewer', async () => {
    mockAllReviewersSucceed();
    await runReviewPanel(makeCtx(), { planContent: '# Plan', architectureDesign: '# Arch', reviewerPersonas: DEFAULT_PERSONAS });
    expect(mockLaunchClaude).toHaveBeenCalledTimes(3);
  });

  it('should return success when all reviewers complete', async () => {
    mockAllReviewersSucceed();
    const result = await runReviewPanel(makeCtx(), { planContent: '# Plan', architectureDesign: '# Arch', reviewerPersonas: DEFAULT_PERSONAS });
    expect(result.success).toBe(true);
    expect(result.reviews).toHaveLength(3);
    expect(result.reviews.every(r => r.success)).toBe(true);
  });

  it('should include reviewer names in results', async () => {
    mockAllReviewersSucceed();
    const result = await runReviewPanel(makeCtx(), { planContent: '# Plan', architectureDesign: '# Arch', reviewerPersonas: DEFAULT_PERSONAS });
    const names = result.reviews.map(r => r.reviewerName).sort();
    expect(names).toEqual(['carmack', 'metz', 'torvalds']);
  });

  it('should return failure when any reviewer fails', async () => {
    mockReviewerFailure();
    const result = await runReviewPanel(makeCtx(), { planContent: '# Plan', architectureDesign: '# Arch', reviewerPersonas: DEFAULT_PERSONAS });
    expect(result.success).toBe(false);
    expect(result.reviews.some(r => !r.success)).toBe(true);
  });

  it('should pass reviewer-specific prompts containing each persona', async () => {
    mockAllReviewersSucceed();
    await runReviewPanel(makeCtx(), { planContent: '# Plan', architectureDesign: '# Arch', reviewerPersonas: DEFAULT_PERSONAS });
    const prompts = mockLaunchClaude.mock.calls.map(c => c[0]!.prompt);
    expect(prompts.some(p => p.includes('correctness'))).toBe(true);
    expect(prompts.some(p => p.includes('design quality'))).toBe(true);
    expect(prompts.some(p => p.includes('simplicity'))).toBe(true);
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

    expect(mockRegister).toHaveBeenCalledTimes(3);
    expect(mockUnregister).toHaveBeenCalledTimes(3);
    for (let i = 0; i < 3; i++) {
      const handle = mockLaunchClaude.mock.results[i]!.value;
      expect(mockRegister).toHaveBeenCalledWith(handle);
      expect(mockUnregister).toHaveBeenCalledWith(handle);
    }
  });
});
