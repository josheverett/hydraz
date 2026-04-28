import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchClaude } from '../claude/executor.js';
import type { TaskLedger, OwnershipMap, ExecutionContext } from './types.js';
import { CONSENSUS_MAX_ROUNDS } from './state.js';
import { readPlan, getSwarmDir } from './artifacts.js';
import { runPlanner } from './planner.js';
import { buildArchitectPlanReviewPrompt } from './prompts/architect-review.js';
import { parseReviewVerdict } from './review-aggregate.js';
import { registerExecutorHandle, unregisterExecutorHandle } from '../orchestration/shutdown.js';

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
  reviewFeedback?: string;
  verbose?: boolean;
  onEvent?: (type: string, message: string) => void;
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
    opts.onEvent?.('swarm.consensus_round_started', `Consensus round ${round}/${maxRounds}`);

    const plannerResult = await runPlanner(ctx, {
      investigationBrief: opts.investigationBrief,
      architectureDesign: currentDesign + (previousFeedback
        ? `\n\n## Architect Feedback from Previous Round\n\n${previousFeedback}\n\nPlease revise the plan to address this feedback.`
        : ''),
      workerCount: opts.workerCount,
      reviewFeedback: opts.reviewFeedback,
    });

    if (plannerResult.executorResult && opts.verbose) {
      const r = plannerResult.executorResult;
      const cost = r.cost != null ? `$${r.cost.toFixed(2)}` : 'n/a';
      const tokensIn = r.inputTokens != null ? `${(r.inputTokens / 1000).toFixed(1)}k in` : '';
      const tokensOut = r.outputTokens != null ? `${(r.outputTokens / 1000).toFixed(1)}k out` : '';
      const tokens = [tokensIn, tokensOut].filter(Boolean).join('/');
      const dur = r.durationMs != null ? `${Math.round(r.durationMs / 1000)}s` : 'n/a';
      opts.onEvent?.('verbose.executor_metrics', `Consensus round ${round} planner: ${cost}, ${tokens || 'n/a tokens'}, ${dur}, exit ${r.exitCode ?? '?'}`);
    }

    if (!plannerResult.success) {
      opts.onEvent?.('swarm.consensus_planner_failed', `Planner failed (round ${round})`);
      return {
        success: false,
        roundsUsed: round,
        finalLedger: null,
        finalOwnership: null,
        error: `Planner failed in round ${round}: ${plannerResult.error}`,
      };
    }

    opts.onEvent?.('swarm.consensus_planner_completed', `Planner completed (round ${round})`);

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

    opts.onEvent?.('swarm.consensus_review_started', `Architect reviewing plan (round ${round})`);

    const reviewPrompt = buildArchitectPlanReviewPrompt(
      ctx.task,
      ctx.sessionName,
      currentDesign,
      plan!,
      round,
      ctx.swarmDir,
      ctx.repoPromptContent,
    );

    const reviewExecutor = launchClaude({
      workingDirectory: ctx.workingDirectory,
      prompt: reviewPrompt,
      config: ctx.config,
    });
    registerExecutorHandle(reviewExecutor);

    const reviewResult = await reviewExecutor.waitForExit();
    unregisterExecutorHandle(reviewExecutor);

    if (opts.verbose) {
      const cost = reviewResult.cost != null ? `$${reviewResult.cost.toFixed(2)}` : 'n/a';
      const tokensIn = reviewResult.inputTokens != null ? `${(reviewResult.inputTokens / 1000).toFixed(1)}k in` : '';
      const tokensOut = reviewResult.outputTokens != null ? `${(reviewResult.outputTokens / 1000).toFixed(1)}k out` : '';
      const tokens = [tokensIn, tokensOut].filter(Boolean).join('/');
      const dur = reviewResult.durationMs != null ? `${Math.round(reviewResult.durationMs / 1000)}s` : 'n/a';
      opts.onEvent?.('verbose.executor_metrics', `Consensus round ${round} architect-review: ${cost}, ${tokens || 'n/a tokens'}, ${dur}, exit ${reviewResult.exitCode ?? '?'}`);
    }

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
      opts.onEvent?.('swarm.consensus_review_completed', `Architect approved plan (round ${round})`);
      return {
        success: true,
        roundsUsed: round,
        finalLedger: ledger,
        finalOwnership: ownership,
      };
    }

    opts.onEvent?.('swarm.consensus_review_completed', `Architect requested changes (round ${round})`);
    if (opts.verbose) {
      const feedbackExcerpt = feedback.split('\n').slice(0, 2).join('\n');
      opts.onEvent?.('verbose.consensus', `Re-planning after architect feedback. Architect said:\n${feedbackExcerpt}`);
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
