import type { SwarmPhase, TaskLedger, OwnershipMap, ExecutionContext } from './types.js';
import type { HydrazConfig } from '../config/schema.js';
import { runInvestigation } from './investigator.js';
import { runArchitect } from './architect.js';
import { runConsensus } from './consensus.js';
import { runWorkerFanout } from './workers.js';
import { runFanIn } from './merge.js';
import { runReviewPanel } from './reviewer.js';
import { aggregateReviews, determineFeedbackRoute } from './review-aggregate.js';
import {
  readInvestigationBrief,
  readArchitectureDesign,
  readPlan,
  readReviewFile,
  getSwarmDir,
} from './artifacts.js';
import { getWorkspaceDir } from '../providers/provider.js';

export interface PipelineCallbacks {
  onPhaseChange?: (phase: SwarmPhase) => void;
  onEvent?: (type: string, message: string) => void;
  onError?: (message: string) => void;
}

export interface PipelineResult {
  success: boolean;
  phase: SwarmPhase;
  outerLoopsUsed: number;
  consensusRoundsUsed: number;
  approved: boolean;
  error?: string;
}

export interface PipelineOptions {
  repoRoot: string;
  sessionId: string;
  sessionName: string;
  task: string;
  workingDirectory: string;
  config: HydrazConfig;
  workerCount: number;
  reviewerPersonas: Array<{ name: string; persona: string }>;
  maxOuterLoops: number;
  maxConsensusRounds: number;
  callbacks?: PipelineCallbacks;
}

function emitPhase(options: PipelineOptions, phase: SwarmPhase): void {
  options.callbacks?.onPhaseChange?.(phase);
}

function emitEvent(options: PipelineOptions, type: string, message: string): void {
  options.callbacks?.onEvent?.(type, message);
}

function buildContext(options: PipelineOptions, swarmDir: string): ExecutionContext {
  return {
    repoRoot: options.repoRoot,
    sessionId: options.sessionId,
    sessionName: options.sessionName,
    task: options.task,
    workingDirectory: options.workingDirectory,
    config: options.config,
    swarmDir,
  };
}

export async function runSwarmPipeline(options: PipelineOptions): Promise<PipelineResult> {
  let investigationBrief: string;
  let architectureDesign: string;
  let planContent: string;
  let ledger: TaskLedger;
  let ownership: OwnershipMap;
  let totalConsensusRounds = 0;
  let workerWorktrees: Record<string, string> | undefined;
  const swarmDir = getSwarmDir(options.repoRoot, options.sessionId);
  const ctx = buildContext(options, swarmDir);

  emitPhase(options, 'investigating');
  emitEvent(options, 'swarm.investigate_started', 'Investigation starting');

  const investigationResult = await runInvestigation(ctx);

  if (!investigationResult.success) {
    return {
      success: false,
      phase: 'investigating',
      outerLoopsUsed: 0,
      consensusRoundsUsed: 0,
      approved: false,
      error: investigationResult.error,
    };
  }

  investigationBrief = readInvestigationBrief(options.repoRoot, options.sessionId) ?? '';
  emitEvent(options, 'swarm.investigate_completed', 'Investigation complete');

  emitPhase(options, 'architecting');
  emitEvent(options, 'swarm.architect_started', 'Architecture starting');

  const architectResult = await runArchitect(ctx, { investigationBrief });

  if (!architectResult.success) {
    return {
      success: false,
      phase: 'architecting',
      outerLoopsUsed: 0,
      consensusRoundsUsed: 0,
      approved: false,
      error: architectResult.error,
    };
  }

  architectureDesign = readArchitectureDesign(options.repoRoot, options.sessionId) ?? '';
  emitEvent(options, 'swarm.architect_completed', 'Architecture complete');

  for (let outerLoop = 0; outerLoop < options.maxOuterLoops; outerLoop++) {
    emitPhase(options, 'planning');
    emitEvent(options, 'swarm.plan_started', `Planning (outer loop ${outerLoop + 1})`);

    const consensusResult = await runConsensus(ctx, {
      investigationBrief,
      architectureDesign,
      workerCount: options.workerCount,
      maxRounds: options.maxConsensusRounds,
    });

    totalConsensusRounds += consensusResult.roundsUsed;

    if (!consensusResult.success) {
      return {
        success: false,
        phase: 'planning',
        outerLoopsUsed: outerLoop + 1,
        consensusRoundsUsed: totalConsensusRounds,
        approved: false,
        error: consensusResult.error,
      };
    }

    ledger = consensusResult.finalLedger!;
    ownership = consensusResult.finalOwnership!;
    planContent = readPlan(options.repoRoot, options.sessionId) ?? '';
    emitEvent(options, 'swarm.plan_completed', `Consensus reached in ${consensusResult.roundsUsed} rounds`);

    emitPhase(options, 'architect-reviewing');
    emitPhase(options, 'fanning-out');
    emitEvent(options, 'swarm.worker_launched', `Launching ${options.workerCount} workers`);

    const workerResult = await runWorkerFanout(ctx, {
      ledger,
      ownership,
      planContent,
      existingWorktrees: workerWorktrees,
    });

    if (!workerWorktrees) {
      workerWorktrees = {};
      for (const wr of workerResult.workerResults) {
        workerWorktrees[wr.workerId] = getWorkspaceDir(options.repoRoot, `${options.sessionId}-${wr.workerId}`);
      }
    }

    emitPhase(options, 'syncing');

    if (!workerResult.success) {
      return {
        success: false,
        phase: 'syncing',
        outerLoopsUsed: outerLoop + 1,
        consensusRoundsUsed: totalConsensusRounds,
        approved: false,
        error: workerResult.error,
      };
    }

    emitPhase(options, 'merging');
    emitEvent(options, 'swarm.merge_started', 'Merging worker branches');

    const mergeResult = runFanIn({
      repoRoot: options.repoRoot,
      sessionId: options.sessionId,
      sessionName: options.sessionName,
      workingDirectory: options.workingDirectory,
      ledger,
    });

    if (!mergeResult.success) {
      return {
        success: false,
        phase: 'merging',
        outerLoopsUsed: outerLoop + 1,
        consensusRoundsUsed: totalConsensusRounds,
        approved: false,
        error: mergeResult.error,
      };
    }

    emitEvent(options, 'swarm.merge_completed', 'Merge complete');

    emitPhase(options, 'reviewing');
    emitEvent(options, 'swarm.review_started', 'Review panel starting');

    const reviewResult = await runReviewPanel(ctx, {
      planContent,
      architectureDesign,
      reviewerPersonas: options.reviewerPersonas,
    });

    if (!reviewResult.success) {
      return {
        success: false,
        phase: 'reviewing',
        outerLoopsUsed: outerLoop + 1,
        consensusRoundsUsed: totalConsensusRounds,
        approved: false,
        error: 'Review panel failed',
      };
    }

    const reviewContents = reviewResult.reviews.map(r => ({
      reviewerName: r.reviewerName,
      content: readReviewFile(options.repoRoot, options.sessionId, r.reviewerName) ?? '',
    }));
    const aggregate = aggregateReviews(reviewContents);
    emitEvent(options, 'swarm.review_completed', `Review complete: ${aggregate.approved ? 'approved' : 'changes requested'}`);

    if (aggregate.approved) {
      return {
        success: true,
        phase: 'completed',
        outerLoopsUsed: outerLoop + 1,
        consensusRoundsUsed: totalConsensusRounds,
        approved: true,
      };
    }

    const route = determineFeedbackRoute(aggregate);
    emitEvent(options, 'swarm.review_feedback', `Feedback route: ${route}`);
    emitEvent(options, 'swarm.outer_loop', `Outer loop ${outerLoop + 2}`);

    if (route === 'architectural') {
      architectureDesign = readArchitectureDesign(options.repoRoot, options.sessionId) ?? architectureDesign;
    }
  }

  return {
    success: false,
    phase: 'blocked',
    outerLoopsUsed: options.maxOuterLoops,
    consensusRoundsUsed: totalConsensusRounds,
    approved: false,
    error: `Outer loop exhausted after ${options.maxOuterLoops} iterations`,
  };
}
