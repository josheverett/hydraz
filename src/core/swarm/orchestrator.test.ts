import { describe, it, expect } from 'vitest';
import { determineFeedbackRoute } from './review-aggregate.js';
import type { ReviewAggregate } from './types.js';

function makeAggregate(overrides: Partial<ReviewAggregate> = {}): ReviewAggregate {
  return {
    approved: true,
    architecturalFindings: [],
    implementationFindings: [],
    reviews: [],
    ...overrides,
  };
}

describe('determineFeedbackRoute', () => {
  it('should return none when approved with no findings', () => {
    const result = determineFeedbackRoute(makeAggregate({ approved: true }));
    expect(result).toBe('none');
  });

  it('should return architectural when there are architectural findings', () => {
    const result = determineFeedbackRoute(makeAggregate({
      approved: false,
      architecturalFindings: [
        { category: 'architectural', description: 'Bad design' },
      ],
    }));
    expect(result).toBe('architectural');
  });

  it('should return implementation when there are only implementation findings', () => {
    const result = determineFeedbackRoute(makeAggregate({
      approved: false,
      implementationFindings: [
        { category: 'implementation', description: 'Missing null check' },
      ],
    }));
    expect(result).toBe('implementation');
  });

  it('should prioritize architectural over implementation when both present', () => {
    const result = determineFeedbackRoute(makeAggregate({
      approved: false,
      architecturalFindings: [
        { category: 'architectural', description: 'Bad coupling' },
      ],
      implementationFindings: [
        { category: 'implementation', description: 'Bug' },
      ],
    }));
    expect(result).toBe('architectural');
  });

  it('should return none when not approved but no categorized findings', () => {
    const result = determineFeedbackRoute(makeAggregate({
      approved: false,
      architecturalFindings: [],
      implementationFindings: [],
    }));
    expect(result).toBe('none');
  });
});
