import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveRepoDataPaths } from '../repo/paths.js';
import { initRepoState, createNewSession } from '../sessions/manager.js';
import { createDefaultConfig } from '../config/schema.js';
import { ensureSwarmDirs } from './artifacts.js';
import { runReviewPanel, type ReviewPanelOptions } from './reviewer.js';
import { buildReviewerPrompt } from './prompts/reviewer.js';

vi.mock('../claude/executor.js', () => ({
  launchClaude: vi.fn(),
}));

import { launchClaude } from '../claude/executor.js';

const mockLaunchClaude = vi.mocked(launchClaude);

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
  const session = createNewSession({
    name: 'test-review',
    repoRoot,
    branchName: 'hydraz/test-review',
    personas: ['architect', 'implementer', 'verifier'],
    executionTarget: 'local',
    task: 'Build the system',
  });
  sessionId = session.id;
  config = createDefaultConfig();
  ensureSwarmDirs(repoRoot, sessionId);
});

afterEach(() => {
  vi.clearAllMocks();
  rmSync(repoRoot, { recursive: true, force: true });
  const paths = resolveRepoDataPaths(repoRoot);
  rmSync(paths.repoDataDir, { recursive: true, force: true });
});

function makeOptions(overrides: Partial<ReviewPanelOptions> = {}): ReviewPanelOptions {
  return {
    repoRoot,
    sessionId,
    sessionName: 'test-review',
    task: 'Build the system',
    workingDirectory: repoRoot,
    config,
    planContent: '# Plan\nDo the thing.',
    architectureDesign: '# Architecture\nMiddleware pattern.',
    reviewerPersonas: DEFAULT_PERSONAS,
    ...overrides,
  };
}

function mockAllReviewersSucceed() {
  mockLaunchClaude.mockReturnValue({
    process: {} as never,
    pid: 12345,
    kill: vi.fn(),
    waitForExit: vi.fn().mockResolvedValue({
      exitCode: 0,
      signal: null,
      success: true,
      cost: 0.20,
    }),
  });
}

function mockReviewerFailure() {
  let callIndex = 0;
  mockLaunchClaude.mockImplementation(() => {
    const shouldFail = callIndex === 1;
    callIndex++;
    return {
      process: {} as never,
      pid: 12345,
      kill: vi.fn(),
      waitForExit: vi.fn().mockResolvedValue({
        exitCode: shouldFail ? 1 : 0,
        signal: null,
        success: !shouldFail,
        cost: 0.20,
      }),
    };
  });
}

describe('buildReviewerPrompt', () => {
  it('should include the task description', () => {
    const prompt = buildReviewerPrompt('Build auth', 'auth-session', '# Plan', '# Arch', 'You are Carmack.', 'carmack');
    expect(prompt).toContain('Build auth');
  });

  it('should include the reviewer persona', () => {
    const prompt = buildReviewerPrompt('Build auth', 'auth-session', '# Plan', '# Arch', 'You are Carmack. Focus on correctness.', 'carmack');
    expect(prompt).toContain('Focus on correctness');
  });

  it('should include the reviewer name', () => {
    const prompt = buildReviewerPrompt('Build auth', 'auth-session', '# Plan', '# Arch', 'Persona text.', 'carmack');
    expect(prompt).toContain('carmack');
  });

  it('should include the plan content', () => {
    const prompt = buildReviewerPrompt('Build auth', 'auth-session', '# Plan\nDetailed steps.', '# Arch', 'Persona.', 'carmack');
    expect(prompt).toContain('Detailed steps');
  });

  it('should include the architecture design', () => {
    const prompt = buildReviewerPrompt('Build auth', 'auth-session', '# Plan', '# Arch\nMiddleware pattern.', 'Persona.', 'carmack');
    expect(prompt).toContain('Middleware pattern');
  });

  it('should instruct categorizing findings as architectural or implementation', () => {
    const prompt = buildReviewerPrompt('Build auth', 'auth-session', '# Plan', '# Arch', 'Persona.', 'carmack');
    expect(prompt).toContain('architectural');
    expect(prompt).toContain('implementation');
  });

  it('should instruct writing review to reviews/<name>.md', () => {
    const prompt = buildReviewerPrompt('Build auth', 'auth-session', '# Plan', '# Arch', 'Persona.', 'carmack');
    expect(prompt).toContain('carmack.md');
  });

  it('should include evidence discipline principles', () => {
    const prompt = buildReviewerPrompt('Build auth', 'auth-session', '# Plan', '# Arch', 'Persona.', 'carmack');
    expect(prompt).toContain('Verified facts');
    expect(prompt).toContain('Assumptions');
  });
});

describe('runReviewPanel', () => {
  it('should launch claude once per reviewer', async () => {
    mockAllReviewersSucceed();

    await runReviewPanel(makeOptions());

    expect(mockLaunchClaude).toHaveBeenCalledTimes(3);
  });

  it('should return success when all reviewers complete', async () => {
    mockAllReviewersSucceed();

    const result = await runReviewPanel(makeOptions());

    expect(result.success).toBe(true);
    expect(result.reviews).toHaveLength(3);
    expect(result.reviews.every(r => r.success)).toBe(true);
  });

  it('should include reviewer names in results', async () => {
    mockAllReviewersSucceed();

    const result = await runReviewPanel(makeOptions());

    const names = result.reviews.map(r => r.reviewerName).sort();
    expect(names).toEqual(['carmack', 'metz', 'torvalds']);
  });

  it('should return failure when any reviewer fails', async () => {
    mockReviewerFailure();

    const result = await runReviewPanel(makeOptions());

    expect(result.success).toBe(false);
    expect(result.reviews.some(r => !r.success)).toBe(true);
  });

  it('should pass reviewer-specific prompts containing each persona', async () => {
    mockAllReviewersSucceed();

    await runReviewPanel(makeOptions());

    const prompts = mockLaunchClaude.mock.calls.map(c => c[0]!.prompt);
    expect(prompts.some(p => p.includes('correctness'))).toBe(true);
    expect(prompts.some(p => p.includes('design quality'))).toBe(true);
    expect(prompts.some(p => p.includes('simplicity'))).toBe(true);
  });
});
