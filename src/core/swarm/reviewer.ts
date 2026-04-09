import { launchClaude, type ExecutorResult } from '../claude/executor.js';
import type { ExecutionContext } from './types.js';
import { buildReviewerPrompt } from './prompts/reviewer.js';

export interface SingleReviewResult {
  reviewerName: string;
  success: boolean;
  executorResult: ExecutorResult | null;
  error?: string;
}

export interface ReviewPanelResult {
  success: boolean;
  reviews: SingleReviewResult[];
  error?: string;
}

export interface ReviewPanelOptions {
  planContent: string;
  architectureDesign: string;
  reviewerPersonas: Array<{ name: string; persona: string }>;
}

async function runSingleReviewer(
  reviewerInfo: { name: string; persona: string },
  ctx: ExecutionContext,
  opts: ReviewPanelOptions,
): Promise<SingleReviewResult> {
  const prompt = buildReviewerPrompt(
    ctx.task,
    ctx.sessionName,
    opts.planContent,
    opts.architectureDesign,
    reviewerInfo.persona,
    reviewerInfo.name,
    ctx.swarmDir,
  );

  const executor = launchClaude({
    workingDirectory: ctx.workingDirectory,
    prompt,
    config: ctx.config,
  });

  const executorResult = await executor.waitForExit();

  return {
    reviewerName: reviewerInfo.name,
    success: executorResult.success,
    executorResult,
    error: executorResult.success ? undefined : `Reviewer ${reviewerInfo.name} failed: exit code ${executorResult.exitCode}`,
  };
}

export async function runReviewPanel(ctx: ExecutionContext, opts: ReviewPanelOptions): Promise<ReviewPanelResult> {
  const reviewPromises = opts.reviewerPersonas.map(persona =>
    runSingleReviewer(persona, ctx, opts),
  );

  const reviews = await Promise.all(reviewPromises);
  const allSucceeded = reviews.every(r => r.success);

  return {
    success: allSucceeded,
    reviews,
    error: allSucceeded ? undefined : 'One or more reviewers failed',
  };
}
