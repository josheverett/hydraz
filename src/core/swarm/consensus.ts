import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchClaude, type ExecutorResult } from '../claude/executor.js';
import type { HydrazConfig } from '../config/schema.js';
import type { TaskLedger, OwnershipMap } from './types.js';
import { CONSENSUS_MAX_ROUNDS } from './state.js';
import { readTaskLedger, readOwnershipMap, readPlan, getSwarmDir } from './artifacts.js';
import { buildPlannerPrompt } from './prompts/planner.js';
import { buildArchitectPlanReviewPrompt } from './prompts/architect-review.js';

export interface ConsensusResult {
  success: boolean;
  roundsUsed: number;
  finalLedger: TaskLedger | null;
  finalOwnership: OwnershipMap | null;
  architectFinalSay: boolean;
  error?: string;
}

export interface ConsensusOptions {
  repoRoot: string;
  sessionId: string;
  task: string;
  sessionName: string;
  workingDirectory: string;
  config: HydrazConfig;
  investigationBrief: string;
  architectureDesign: string;
  workerCount: number;
}

function readFeedback(repoRoot: string, sessionId: string, round: number): string | null {
  const feedbackPath = join(getSwarmDir(repoRoot, sessionId), 'architecture', 'feedback', `round-${round}.md`);
  if (!existsSync(feedbackPath)) return null;
  return readFileSync(feedbackPath, 'utf-8');
}

function isApproved(feedback: string): boolean {
  const firstLine = feedback.split('\n')[0]?.trim().toUpperCase() ?? '';
  return firstLine.startsWith('APPROVED');
}

export async function runConsensus(options: ConsensusOptions): Promise<ConsensusResult> {
  let currentDesign = options.architectureDesign;
  let previousFeedback: string | null = null;

  for (let round = 1; round <= CONSENSUS_MAX_ROUNDS; round++) {
    const plannerPrompt = previousFeedback
      ? buildPlannerPrompt(options.task, options.sessionName, options.investigationBrief, currentDesign, options.workerCount)
        + `\n\n## Architect Feedback from Previous Round\n\n${previousFeedback}\n\nPlease revise the plan to address this feedback.`
      : buildPlannerPrompt(options.task, options.sessionName, options.investigationBrief, currentDesign, options.workerCount);

    const plannerExecutor = launchClaude({
      workingDirectory: options.workingDirectory,
      prompt: plannerPrompt,
      config: options.config,
    });

    const plannerResult = await plannerExecutor.waitForExit();

    if (!plannerResult.success) {
      return {
        success: false,
        roundsUsed: round,
        finalLedger: null,
        finalOwnership: null,
        architectFinalSay: false,
        error: `Planner failed in round ${round}: exit code ${plannerResult.exitCode}`,
      };
    }

    const ledger = readTaskLedger(options.repoRoot, options.sessionId);
    const ownership = readOwnershipMap(options.repoRoot, options.sessionId);
    const plan = readPlan(options.repoRoot, options.sessionId);

    if (!ledger || !ownership || !plan) {
      return {
        success: false,
        roundsUsed: round,
        finalLedger: ledger,
        finalOwnership: ownership,
        architectFinalSay: false,
        error: `Planner in round ${round} did not produce all required artifacts`,
      };
    }

    if (round === CONSENSUS_MAX_ROUNDS) {
      return {
        success: true,
        roundsUsed: round,
        finalLedger: ledger,
        finalOwnership: ownership,
        architectFinalSay: true,
      };
    }

    const reviewPrompt = buildArchitectPlanReviewPrompt(
      options.task,
      options.sessionName,
      currentDesign,
      plan,
      round,
    );

    const reviewExecutor = launchClaude({
      workingDirectory: options.workingDirectory,
      prompt: reviewPrompt,
      config: options.config,
    });

    const reviewResult = await reviewExecutor.waitForExit();

    if (!reviewResult.success) {
      return {
        success: false,
        roundsUsed: round,
        finalLedger: ledger,
        finalOwnership: ownership,
        architectFinalSay: false,
        error: `Architect review failed in round ${round}: exit code ${reviewResult.exitCode}`,
      };
    }

    const feedback = readFeedback(options.repoRoot, options.sessionId, round);

    if (!feedback) {
      return {
        success: true,
        roundsUsed: round,
        finalLedger: ledger,
        finalOwnership: ownership,
        architectFinalSay: false,
      };
    }

    if (isApproved(feedback)) {
      return {
        success: true,
        roundsUsed: round,
        finalLedger: ledger,
        finalOwnership: ownership,
        architectFinalSay: false,
      };
    }

    previousFeedback = feedback;
  }

  return {
    success: false,
    roundsUsed: CONSENSUS_MAX_ROUNDS,
    finalLedger: null,
    finalOwnership: null,
    architectFinalSay: true,
    error: 'Consensus loop exhausted without resolution',
  };
}
