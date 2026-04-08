import type { HydrazConfig } from '../config/schema.js';
import type { ReviewAggregate } from './types.js';

export type FeedbackRoute = 'architectural' | 'implementation' | 'none';

export interface OrchestratorResult {
  success: boolean;
  outerLoopsUsed: number;
  finalRoute: FeedbackRoute;
  approved: boolean;
  error?: string;
}

export interface OrchestratorOptions {
  repoRoot: string;
  sessionId: string;
  sessionName: string;
  task: string;
  workingDirectory: string;
  config: HydrazConfig;
  maxOuterLoops: number;
}

export function determineFeedbackRoute(_aggregate: ReviewAggregate): FeedbackRoute {
  return 'none';
}

export async function runOuterLoop(_options: OrchestratorOptions): Promise<OrchestratorResult> {
  return {
    success: false,
    outerLoopsUsed: 0,
    finalRoute: 'none',
    approved: false,
    error: 'not implemented',
  };
}
