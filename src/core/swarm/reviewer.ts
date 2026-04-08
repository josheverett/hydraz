import { launchClaude, type ExecutorResult, type ContainerContext } from '../claude/executor.js';
import type { HydrazConfig } from '../config/schema.js';
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
  repoRoot: string;
  sessionId: string;
  sessionName: string;
  task: string;
  workingDirectory: string;
  config: HydrazConfig;
  planContent: string;
  architectureDesign: string;
  reviewerPersonas: Array<{ name: string; persona: string }>;
  swarmDir?: string;
  containerContext?: ContainerContext;
}

async function runSingleReviewer(
  reviewerInfo: { name: string; persona: string },
  options: ReviewPanelOptions,
): Promise<SingleReviewResult> {
  const prompt = buildReviewerPrompt(
    options.task,
    options.sessionName,
    options.planContent,
    options.architectureDesign,
    reviewerInfo.persona,
    reviewerInfo.name,
    options.swarmDir,
  );

  const executor = launchClaude({
    workingDirectory: options.workingDirectory,
    prompt,
    config: options.config,
    containerContext: options.containerContext,
  });

  const executorResult = await executor.waitForExit();

  return {
    reviewerName: reviewerInfo.name,
    success: executorResult.success,
    executorResult,
    error: executorResult.success ? undefined : `Reviewer ${reviewerInfo.name} failed: exit code ${executorResult.exitCode}`,
  };
}

export async function runReviewPanel(options: ReviewPanelOptions): Promise<ReviewPanelResult> {
  const reviewPromises = options.reviewerPersonas.map(persona =>
    runSingleReviewer(persona, options),
  );

  const reviews = await Promise.all(reviewPromises);
  const allSucceeded = reviews.every(r => r.success);

  return {
    success: allSucceeded,
    reviews,
    error: allSucceeded ? undefined : 'One or more reviewers failed',
  };
}
