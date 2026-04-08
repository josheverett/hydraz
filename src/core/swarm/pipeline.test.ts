import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveRepoDataPaths } from '../repo/paths.js';
import { initRepoState, createNewSession } from '../sessions/manager.js';
import { createDefaultConfig } from '../config/schema.js';
import { ensureSwarmDirs } from './artifacts.js';
import { runSwarmPipeline, type PipelineOptions } from './pipeline.js';
import type { SwarmPhase } from './types.js';

vi.mock('./investigator.js', () => ({
  runInvestigation: vi.fn().mockResolvedValue({
    success: true,
    briefPath: '/tmp/brief.md',
    executorResult: { exitCode: 0, signal: null, success: true },
  }),
}));

vi.mock('./architect.js', () => ({
  runArchitect: vi.fn().mockResolvedValue({
    success: true,
    designPath: '/tmp/design.md',
    executorResult: { exitCode: 0, signal: null, success: true },
  }),
}));

vi.mock('./consensus.js', () => ({
  runConsensus: vi.fn().mockResolvedValue({
    success: true,
    roundsUsed: 1,
    finalLedger: {
      swarmPhase: 'planning',
      baseCommit: 'abc123',
      outerLoop: 0,
      consensusRound: 0,
      tasks: [{ id: 't1', title: 'Task', description: 'Do it', assignedWorker: 'worker-a', ownedPaths: ['src/'], acceptanceCriteria: ['works'], interfaceContracts: [], status: 'pending' }],
      workers: { 'worker-a': { branch: 'hydraz/test-worker-a', status: 'pending' } },
      stages: {},
    },
    finalOwnership: { workers: { 'worker-a': { paths: ['src/'], exclusive: true } }, shared: [] },
    architectFinalSay: false,
  }),
}));

vi.mock('./workers.js', () => ({
  runWorkerFanout: vi.fn().mockResolvedValue({
    success: true,
    workerResults: [{ workerId: 'worker-a', success: true, executorResult: { exitCode: 0, signal: null, success: true } }],
  }),
}));

vi.mock('./merge.js', () => ({
  runFanIn: vi.fn().mockReturnValue({
    success: true,
    integrationBranch: 'hydraz/test-pipeline',
    workerMerges: [{ workerId: 'worker-a', branch: 'hydraz/test-worker-a', outcome: 'clean' }],
    reportPath: '/tmp/merge-report.md',
  }),
}));

vi.mock('./reviewer.js', () => ({
  runReviewPanel: vi.fn().mockResolvedValue({
    success: true,
    reviews: [
      { reviewerName: 'carmack', success: true, executorResult: { exitCode: 0, signal: null, success: true } },
      { reviewerName: 'metz', success: true, executorResult: { exitCode: 0, signal: null, success: true } },
      { reviewerName: 'torvalds', success: true, executorResult: { exitCode: 0, signal: null, success: true } },
    ],
  }),
}));

vi.mock('./artifacts.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./artifacts.js')>();
  return {
    ...actual,
    readInvestigationBrief: vi.fn().mockReturnValue('# Investigation\nFindings.'),
    readArchitectureDesign: vi.fn().mockReturnValue('# Architecture\nDesign.'),
    readPlan: vi.fn().mockReturnValue('# Plan\nSteps.'),
    readReviewFile: vi.fn().mockReturnValue('APPROVED\n\nLooks good.'),
  };
});

vi.mock('./review-aggregate.js', () => ({
  aggregateReviews: vi.fn().mockReturnValue({
    approved: true,
    architecturalFindings: [],
    implementationFindings: [],
    reviews: [],
  }),
}));

import { runInvestigation } from './investigator.js';
import { runArchitect } from './architect.js';
import { runConsensus } from './consensus.js';
import { runWorkerFanout } from './workers.js';
import { runFanIn } from './merge.js';
import { runReviewPanel } from './reviewer.js';
import { aggregateReviews } from './review-aggregate.js';

let repoRoot: string;
let sessionId: string;
let config: ReturnType<typeof createDefaultConfig>;

const DEFAULT_PERSONAS = [
  { name: 'carmack', persona: 'Correctness.' },
  { name: 'metz', persona: 'Design quality.' },
  { name: 'torvalds', persona: 'Simplicity.' },
];

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), 'hydraz-pipeline-test-'));
  initRepoState(repoRoot);
  const session = createNewSession({
    name: 'test-pipeline',
    repoRoot,
    branchName: 'hydraz/test-pipeline',
    personas: ['architect', 'implementer', 'verifier'],
    executionTarget: 'local',
    task: 'Build it',
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

function makeOptions(overrides: Partial<PipelineOptions> = {}): PipelineOptions {
  return {
    repoRoot,
    sessionId,
    sessionName: 'test-pipeline',
    task: 'Build it',
    workingDirectory: repoRoot,
    config,
    workerCount: 1,
    reviewerPersonas: DEFAULT_PERSONAS,
    maxOuterLoops: 5,
    maxConsensusRounds: 10,
    ...overrides,
  };
}

describe('runSwarmPipeline', () => {
  it('should call all stages in order for happy path', async () => {
    await runSwarmPipeline(makeOptions());

    expect(runInvestigation).toHaveBeenCalledTimes(1);
    expect(runArchitect).toHaveBeenCalledTimes(1);
    expect(runConsensus).toHaveBeenCalledTimes(1);
    expect(runWorkerFanout).toHaveBeenCalledTimes(1);
    expect(runFanIn).toHaveBeenCalledTimes(1);
    expect(runReviewPanel).toHaveBeenCalledTimes(1);
    expect(aggregateReviews).toHaveBeenCalledTimes(1);
  });

  it('should return success and approved on happy path', async () => {
    const result = await runSwarmPipeline(makeOptions());

    expect(result.success).toBe(true);
    expect(result.approved).toBe(true);
  });

  it('should pass actual review file contents to aggregateReviews, not empty strings', async () => {
    await runSwarmPipeline(makeOptions());

    const aggregateCall = vi.mocked(aggregateReviews).mock.calls[0]![0]!;
    const hasNonEmptyContent = aggregateCall.some((r: { content: string }) => r.content.length > 0);
    expect(hasNonEmptyContent).toBe(true);
  });

  it('should report phase changes via callbacks', async () => {
    const phases: SwarmPhase[] = [];
    await runSwarmPipeline(makeOptions({
      callbacks: { onPhaseChange: (phase) => phases.push(phase) },
    }));

    expect(phases).toContain('investigating');
    expect(phases).toContain('architecting');
    expect(phases).toContain('planning');
    expect(phases).toContain('fanning-out');
    expect(phases).toContain('merging');
    expect(phases).toContain('reviewing');
  });

  it('should stop and return failure if investigation fails', async () => {
    vi.mocked(runInvestigation).mockResolvedValueOnce({
      success: false,
      briefPath: null,
      executorResult: null,
      error: 'Investigation failed',
    });

    const result = await runSwarmPipeline(makeOptions());

    expect(result.success).toBe(false);
    expect(runArchitect).not.toHaveBeenCalled();
  });

  it('should stop and return failure if consensus fails', async () => {
    vi.mocked(runConsensus).mockResolvedValueOnce({
      success: false,
      roundsUsed: 1,
      finalLedger: null,
      finalOwnership: null,
      architectFinalSay: false,
      error: 'Consensus failed',
    });

    const result = await runSwarmPipeline(makeOptions());

    expect(result.success).toBe(false);
    expect(runWorkerFanout).not.toHaveBeenCalled();
  });

  it('should stop and return failure if worker fanout fails', async () => {
    vi.mocked(runWorkerFanout).mockResolvedValueOnce({
      success: false,
      workerResults: [],
      error: 'Workers failed',
    });

    const result = await runSwarmPipeline(makeOptions());

    expect(result.success).toBe(false);
    expect(runFanIn).not.toHaveBeenCalled();
  });

  it('should stop and return failure if merge fails', async () => {
    vi.mocked(runFanIn).mockReturnValueOnce({
      success: false,
      integrationBranch: 'hydraz/test',
      workerMerges: [],
      reportPath: null,
      error: 'Merge conflict',
    });

    const result = await runSwarmPipeline(makeOptions());

    expect(result.success).toBe(false);
    expect(runReviewPanel).not.toHaveBeenCalled();
  });
});
