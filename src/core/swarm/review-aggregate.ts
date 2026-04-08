import type { ReviewAggregate, ReviewFinding } from './types.js';

export function parseReviewVerdict(_reviewContent: string): 'approve' | 'changes-requested' {
  return 'approve';
}

export function parseReviewFindings(_reviewContent: string): ReviewFinding[] {
  return [];
}

export function aggregateReviews(
  _reviews: Array<{ reviewerName: string; content: string }>,
): ReviewAggregate {
  return {
    approved: false,
    architecturalFindings: [],
    implementationFindings: [],
    reviews: [],
  };
}
