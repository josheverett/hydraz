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

export function determineFeedbackRoute(aggregate: ReviewAggregate): FeedbackRoute {
  if (aggregate.approved) return 'none';
  if (aggregate.architecturalFindings.length > 0) return 'architectural';
  if (aggregate.implementationFindings.length > 0) return 'implementation';
  return 'none';
}
