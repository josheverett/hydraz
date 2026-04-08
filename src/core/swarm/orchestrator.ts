import type { ReviewAggregate } from './types.js';

export type FeedbackRoute = 'architectural' | 'implementation' | 'none';

export function determineFeedbackRoute(aggregate: ReviewAggregate): FeedbackRoute {
  if (aggregate.approved) return 'none';
  if (aggregate.architecturalFindings.length > 0) return 'architectural';
  if (aggregate.implementationFindings.length > 0) return 'implementation';
  return 'none';
}
