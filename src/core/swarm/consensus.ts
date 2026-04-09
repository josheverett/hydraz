import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchClaude } from '../claude/executor.js';
import type { TaskLedger, OwnershipMap, ExecutionContext } from './types.js';
import { CONSENSUS_MAX_ROUNDS } from './state.js';
import { readPlan, getSwarmDir } from './artifacts.js';
import { runPlanner } from './planner.js';
import { buildArchitectPlanReviewPrompt } from './prompts/architect-review.js';
import { parseReviewVerdict } from './review-aggregate.js';

export interface ConsensusResult {
  success: boolean;
  roundsUsed: number;
  finalLedger: TaskLedger | null;
  finalOwnership: OwnershipMap | null;
  error?: string;
}

export interface ConsensusOptions {
  investigationBrief: string;
  architectureDesign: string;
  workerCount: number;
  maxRounds?: number;
}

function readFeedback(repoRoot: string, sessionId: string, round: number): string | null {
  const feedbackPath = join(getSwarmDir(repoRoot, sessionId), 'architecture', 'feedback', `round-${round}.md`);
  if (!existsSync(feedbackPath)) return null;
  return readFileSync(feedbackPath, 'utf-8');
}

export async function runConsensus(ctx: ExecutionContext, opts: ConsensusOptions): Promise<ConsensusResult> {
  let currentDesign = opts.architectureDesign;
  let previousFeedback: string | null = null;
  const maxRounds = opts.maxRounds ?? CONSENSUS_MAX_ROUNDS;

  for (let round = 1; round <= maxRounds; round++) {
    const plannerResult = await runPlanner(ctx, {
      investigationBrief: opts.investigationBrief,
      architectureDesign: currentDesign + (previousFeedback
        ? `\n\n## Architect Feedback from Previous Round\n\n${previousFeedback}\n\nPlease revise the plan to address this feedback.`
        : ''),
      workerCount: opts.workerCount,
    });

    if (!plannerResult.success) {
      return {
        success: false,
        roundsUsed: round,
        finalLedger: null,
        finalOwnership: null,
        error: `Planner failed in round ${round}: ${plannerResult.error}`,
      };
    }

    const ledger = plannerResult.ledger!;
    const ownership = plannerResult.ownership!;
    const plan = readPlan(ctx.repoRoot, ctx.sessionId);

    if (round === maxRounds) {
      return {
        success: true,
        roundsUsed: round,
        finalLedger: ledger,
        finalOwnership: ownership,
      };
    }

    const reviewPrompt = buildArchitectPlanReviewPrompt(
      ctx.task,
      ctx.sessionName,
      currentDesign,
      plan!,
      round,
      ctx.swarmDir,
    );

    const reviewExecutor = launchClaude({
      workingDirectory: ctx.workingDirectory,
      prompt: reviewPrompt,
      config: ctx.config,
    });

    const reviewResult = await reviewExecutor.waitForExit();

    if (!reviewResult.success) {
      return {
        success: false,
        roundsUsed: round,
        finalLedger: ledger,
        finalOwnership: ownership,
        error: `Architect review failed in round ${round}: exit code ${reviewResult.exitCode}`,
      };
    }

    const feedback = readFeedback(ctx.repoRoot, ctx.sessionId, round);

    if (!feedback || parseReviewVerdict(feedback) === 'approve') {
      return {
        success: true,
        roundsUsed: round,
        finalLedger: ledger,
        finalOwnership: ownership,
      };
    }

    previousFeedback = feedback;
  }

  return {
    success: false,
    roundsUsed: maxRounds,
    finalLedger: null,
    finalOwnership: null,
    error: 'Consensus loop exhausted without resolution',
  };
}
