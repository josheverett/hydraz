import type { ExecutorResult } from '../claude/executor.js';
import type { HydrazConfig } from '../config/schema.js';

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
}

export async function runReviewPanel(_options: ReviewPanelOptions): Promise<ReviewPanelResult> {
  return {
    success: false,
    reviews: [],
    error: 'not implemented',
  };
}
