import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveRepoDataPaths } from '../repo/paths.js';
import { initRepoState, createNewSession } from '../sessions/manager.js';
import { createDefaultConfig } from '../config/schema.js';
import { ensureSwarmDirs, writeTaskLedger, writeOwnershipMap, writeWorkerBrief, writePlan, writeArchitectureDesign, getSwarmDir } from './artifacts.js';
import { runConsensus } from './consensus.js';
import { buildArchitectPlanReviewPrompt } from './prompts/architect-review.js';
import type { TaskLedger, OwnershipMap, ExecutionContext } from './types.js';
import { mkdirSync, writeFileSync } from 'node:fs';

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

const SAMPLE_BRIEF = '# Investigation\nTypeScript project.';
const SAMPLE_DESIGN = '# Architecture\nMiddleware pattern.';

const VALID_LEDGER: TaskLedger = {
  swarmPhase: 'planning', baseCommit: 'abc123', outerLoop: 0, consensusRound: 0,
  tasks: [{ id: 'task-1', title: 'Auth middleware', description: 'Create JWT validation', assignedWorker: 'worker-a', ownedPaths: ['src/auth/'], acceptanceCriteria: ['JWT validated'], interfaceContracts: [], status: 'pending' }],
  workers: { 'worker-a': { branch: 'hydraz/test-worker-a', status: 'pending' } },
  stages: {},
};

const VALID_OWNERSHIP: OwnershipMap = { workers: { 'worker-a': { paths: ['src/auth/'], exclusive: true } }, shared: ['package.json'] };

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), 'hydraz-consensus-test-'));
  initRepoState(repoRoot);
  const session = createNewSession({ name: 'test-consensus', repoRoot, branchName: 'hydraz/test-consensus', personas: ['architect', 'implementer', 'verifier'], executionTarget: 'local', task: 'Build auth' });
  sessionId = session.id;
  config = createDefaultConfig();
  ensureSwarmDirs(repoRoot, sessionId);
});

afterEach(() => { vi.clearAllMocks(); rmSync(repoRoot, { recursive: true, force: true }); const paths = resolveRepoDataPaths(repoRoot); rmSync(paths.repoDataDir, { recursive: true, force: true }); });

function makeCtx(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return { repoRoot, sessionId, task: 'Build auth', sessionName: 'test-consensus', workingDirectory: repoRoot, config, swarmDir: getSwarmDir(repoRoot, sessionId), ...overrides };
}

function writePlannerArtifacts() {
  writePlan(repoRoot, sessionId, '# Plan\nDo auth.');
  writeTaskLedger(repoRoot, sessionId, VALID_LEDGER);
  writeOwnershipMap(repoRoot, sessionId, VALID_OWNERSHIP);
  writeWorkerBrief(repoRoot, sessionId, 'worker-a', '# Worker A\nDo auth.');
}

function mockClaudeSequence(results: Array<{ success: boolean; writePlanArtifacts?: boolean; writeFeedback?: boolean; feedbackRound?: number }>) {
  let callIndex = 0;
  mockLaunchClaude.mockImplementation(() => {
    const spec = results[callIndex] ?? results[results.length - 1]!;
    callIndex++;
    if (spec.writePlanArtifacts) writePlannerArtifacts();
    if (spec.writeFeedback && spec.feedbackRound !== undefined) {
      const feedbackDir = join(getSwarmDir(repoRoot, sessionId), 'architecture', 'feedback');
      mkdirSync(feedbackDir, { recursive: true });
      writeFileSync(join(feedbackDir, `round-${spec.feedbackRound}.md`), '# Feedback\nNeeds more error handling.', { mode: 0o600 });
    }
    return { process: {} as never, pid: 12345, kill: vi.fn(), waitForExit: vi.fn().mockResolvedValue({ exitCode: spec.success ? 0 : 1, signal: null, success: spec.success, cost: 0.20 }) };
  });
}

describe('buildArchitectPlanReviewPrompt', () => {
  it('should include the task description', () => { expect(buildArchitectPlanReviewPrompt('Build auth', 'auth-session', SAMPLE_DESIGN, '# Plan\nSteps.', 1)).toContain('Build auth'); });
  it('should include the architecture design', () => { expect(buildArchitectPlanReviewPrompt('Build auth', 'auth-session', SAMPLE_DESIGN, '# Plan\nSteps.', 1)).toContain('Middleware pattern'); });
  it('should include the plan content', () => { expect(buildArchitectPlanReviewPrompt('Build auth', 'auth-session', SAMPLE_DESIGN, '# Plan\nDo steps.', 1)).toContain('Do steps'); });
  it('should include the round number', () => { expect(buildArchitectPlanReviewPrompt('Build auth', 'auth-session', SAMPLE_DESIGN, '# Plan\nSteps.', 3)).toContain('3'); });
  it('should instruct writing feedback to architecture/feedback/', () => { expect(buildArchitectPlanReviewPrompt('Build auth', 'auth-session', SAMPLE_DESIGN, '# Plan\nSteps.', 1)).toContain('feedback'); });
  it('should include evidence discipline principles', () => { const p = buildArchitectPlanReviewPrompt('Build auth', 'auth-session', SAMPLE_DESIGN, '# Plan\nSteps.', 1); expect(p).toContain('Verified facts'); expect(p).toContain('Assumptions'); });
  it('should include the absolute swarm directory path when provided', () => { expect(buildArchitectPlanReviewPrompt('Build auth', 'auth-session', SAMPLE_DESIGN, '# Plan\nSteps.', 1, '/tmp/swarm')).toContain('/tmp/swarm'); });

  it('should include repo prompt content when provided', () => {
    const prompt = buildArchitectPlanReviewPrompt('Build auth', 'auth-session', SAMPLE_DESIGN, '# Plan\nSteps.', 1, undefined, 'Always read CLAUDE.md files.');
    expect(prompt).toContain('Always read CLAUDE.md files.');
  });

  it('should not include repo-specific section when repoPromptContent is not provided', () => {
    const prompt = buildArchitectPlanReviewPrompt('Build auth', 'auth-session', SAMPLE_DESIGN, '# Plan\nSteps.', 1);
    expect(prompt).not.toContain('Repo-Specific');
  });
});

describe('runConsensus', () => {
  it('should succeed on first round when planner produces valid artifacts and architect approves', async () => {
    mockClaudeSequence([{ success: true, writePlanArtifacts: true }, { success: true }]);
    const result = await runConsensus(makeCtx(), { investigationBrief: SAMPLE_BRIEF, architectureDesign: SAMPLE_DESIGN, workerCount: 3 });
    expect(result.success).toBe(true);
    expect(result.roundsUsed).toBe(1);
    expect(result.finalLedger).toBeTruthy();
    expect(result.finalOwnership).toBeTruthy();
  });

  it('should call launchClaude at least twice (planner + architect review)', async () => {
    mockClaudeSequence([{ success: true, writePlanArtifacts: true }, { success: true }]);
    await runConsensus(makeCtx(), { investigationBrief: SAMPLE_BRIEF, architectureDesign: SAMPLE_DESIGN, workerCount: 3 });
    expect(mockLaunchClaude).toHaveBeenCalledTimes(2);
  });

  it('should return failure when planner fails on first round', async () => {
    mockClaudeSequence([{ success: false }]);
    const result = await runConsensus(makeCtx(), { investigationBrief: SAMPLE_BRIEF, architectureDesign: SAMPLE_DESIGN, workerCount: 3 });
    expect(result.success).toBe(false);
    expect(result.roundsUsed).toBe(1);
  });

  it('should return failure when planner produces artifacts but architect review fails', async () => {
    mockClaudeSequence([{ success: true, writePlanArtifacts: true }, { success: false }]);
    const result = await runConsensus(makeCtx(), { investigationBrief: SAMPLE_BRIEF, architectureDesign: SAMPLE_DESIGN, workerCount: 3 });
    expect(result.success).toBe(false);
  });

  it('should respect custom maxRounds when provided', async () => {
    mockClaudeSequence([
      { success: true, writePlanArtifacts: true },
      { success: true, writeFeedback: true, feedbackRound: 1 },
      { success: true, writePlanArtifacts: true },
    ]);
    const result = await runConsensus(makeCtx(), {
      investigationBrief: SAMPLE_BRIEF,
      architectureDesign: SAMPLE_DESIGN,
      workerCount: 3,
      maxRounds: 2,
    });
    expect(result.roundsUsed).toBe(2);
  });

  it('should include repoPromptContent in the architect review prompt when set on context', async () => {
    mockClaudeSequence([{ success: true, writePlanArtifacts: true }, { success: true }]);
    await runConsensus(makeCtx({ repoPromptContent: 'Always read CLAUDE.md files.' }), {
      investigationBrief: SAMPLE_BRIEF,
      architectureDesign: SAMPLE_DESIGN,
      workerCount: 3,
    });
    const reviewCallArgs = mockLaunchClaude.mock.calls[1]![0]!;
    expect(reviewCallArgs.prompt).toContain('Always read CLAUDE.md files.');
  });

  it('should register and unregister executor handles for both planner and architect review', async () => {
    mockClaudeSequence([{ success: true, writePlanArtifacts: true }, { success: true }]);
    await runConsensus(makeCtx(), {
      investigationBrief: SAMPLE_BRIEF,
      architectureDesign: SAMPLE_DESIGN,
      workerCount: 3,
    });

    expect(mockRegister).toHaveBeenCalledTimes(2);
    expect(mockUnregister).toHaveBeenCalledTimes(2);
  });

  describe('event streaming', () => {
    it('should emit consensus_round_started event at the beginning of each round', async () => {
      mockClaudeSequence([{ success: true, writePlanArtifacts: true }, { success: true }]);
      const onEvent = vi.fn();
      await runConsensus(makeCtx(), {
        investigationBrief: SAMPLE_BRIEF,
        architectureDesign: SAMPLE_DESIGN,
        workerCount: 3,
        onEvent,
      });
      expect(onEvent).toHaveBeenCalledWith(
        'swarm.consensus_round_started',
        expect.stringContaining('1'),
      );
    });

    it('should emit consensus_planner_completed event after planner succeeds', async () => {
      mockClaudeSequence([{ success: true, writePlanArtifacts: true }, { success: true }]);
      const onEvent = vi.fn();
      await runConsensus(makeCtx(), {
        investigationBrief: SAMPLE_BRIEF,
        architectureDesign: SAMPLE_DESIGN,
        workerCount: 3,
        onEvent,
      });
      expect(onEvent).toHaveBeenCalledWith(
        'swarm.consensus_planner_completed',
        expect.stringContaining('round 1'),
      );
    });

    it('should emit consensus_review_started event before architect review', async () => {
      mockClaudeSequence([{ success: true, writePlanArtifacts: true }, { success: true }]);
      const onEvent = vi.fn();
      await runConsensus(makeCtx(), {
        investigationBrief: SAMPLE_BRIEF,
        architectureDesign: SAMPLE_DESIGN,
        workerCount: 3,
        onEvent,
      });
      expect(onEvent).toHaveBeenCalledWith(
        'swarm.consensus_review_started',
        expect.stringContaining('round 1'),
      );
    });

    it('should emit consensus_review_completed with approved verdict when plan is approved', async () => {
      mockClaudeSequence([{ success: true, writePlanArtifacts: true }, { success: true }]);
      const onEvent = vi.fn();
      await runConsensus(makeCtx(), {
        investigationBrief: SAMPLE_BRIEF,
        architectureDesign: SAMPLE_DESIGN,
        workerCount: 3,
        onEvent,
      });
      expect(onEvent).toHaveBeenCalledWith(
        'swarm.consensus_review_completed',
        expect.stringMatching(/approved/i),
      );
    });

    it('should emit consensus_review_completed with changes-requested when plan is rejected', async () => {
      mockClaudeSequence([
        { success: true, writePlanArtifacts: true },
        { success: true, writeFeedback: true, feedbackRound: 1 },
        { success: true, writePlanArtifacts: true },
      ]);
      const onEvent = vi.fn();
      await runConsensus(makeCtx(), {
        investigationBrief: SAMPLE_BRIEF,
        architectureDesign: SAMPLE_DESIGN,
        workerCount: 3,
        maxRounds: 2,
        onEvent,
      });
      expect(onEvent).toHaveBeenCalledWith(
        'swarm.consensus_review_completed',
        expect.stringMatching(/changes/i),
      );
    });

    it('should emit consensus_planner_failed event when planner fails', async () => {
      mockClaudeSequence([{ success: false }]);
      const onEvent = vi.fn();
      await runConsensus(makeCtx(), {
        investigationBrief: SAMPLE_BRIEF,
        architectureDesign: SAMPLE_DESIGN,
        workerCount: 3,
        onEvent,
      });
      expect(onEvent).toHaveBeenCalledWith(
        'swarm.consensus_planner_failed',
        expect.stringContaining('round 1'),
      );
    });

    it('should emit correct event sequence for multi-round consensus', async () => {
      mockClaudeSequence([
        { success: true, writePlanArtifacts: true },
        { success: true, writeFeedback: true, feedbackRound: 1 },
        { success: true, writePlanArtifacts: true },
      ]);
      const onEvent = vi.fn();
      await runConsensus(makeCtx(), {
        investigationBrief: SAMPLE_BRIEF,
        architectureDesign: SAMPLE_DESIGN,
        workerCount: 3,
        maxRounds: 2,
        onEvent,
      });

      const eventTypes = onEvent.mock.calls.map((c) => c[0]);
      expect(eventTypes).toEqual([
        'swarm.consensus_round_started',
        'swarm.consensus_planner_completed',
        'swarm.consensus_review_started',
        'swarm.consensus_review_completed',
        'swarm.consensus_round_started',
        'swarm.consensus_planner_completed',
      ]);
    });
  });
});
