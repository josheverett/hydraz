import { describe, it, expect } from 'vitest';
import {
  parseReviewVerdict,
  parseReviewFindings,
  aggregateReviews,
  determineFeedbackRoute,
} from './review-aggregate.js';
import { DEFAULT_SWARM_CONFIG } from './types.js';

const APPROVED_REVIEW = `APPROVED

Great work overall. A few minor observations but nothing blocking.

## Findings

No significant issues found.

## Summary

Clean implementation with good test coverage.
`;

const CHANGES_REVIEW = `CHANGES REQUESTED

Several issues need attention before this can be approved.

## Findings

- Category: architectural
  File: src/auth/middleware.ts
  Description: The auth middleware is tightly coupled to the JWT library. Should use an abstraction.
  Why: Makes it impossible to swap JWT providers without changing every consumer.
  Recommendation: Extract an AuthProvider interface.

- Category: implementation
  File: src/api/routes.ts:42
  Description: Missing null check on user parameter.
  Why: Will throw at runtime if auth middleware passes undefined.
  Recommendation: Add guard clause.

## Summary

Needs architectural cleanup in auth module and a bug fix in routes.
`;

const MIXED_REVIEW = `CHANGES REQUESTED

One implementation issue found.

## Findings

- Category: implementation
  File: src/db/connection.ts:15
  Description: Connection pool size is hardcoded.
  Why: Should be configurable for different environments.
  Recommendation: Read from config.

## Summary

Minor fix needed.
`;

describe('parseReviewVerdict', () => {
  it('should parse APPROVED verdict', () => {
    expect(parseReviewVerdict(APPROVED_REVIEW)).toBe('approve');
  });

  it('should parse CHANGES REQUESTED verdict', () => {
    expect(parseReviewVerdict(CHANGES_REVIEW)).toBe('changes-requested');
  });

  it('should default to approve for unrecognized text', () => {
    expect(parseReviewVerdict('Some random text\nStuff.')).toBe('approve');
  });

  it('should parse CHANGES REQUESTED with markdown heading', () => {
    expect(parseReviewVerdict('# CHANGES REQUESTED\n\nSome issues.')).toBe('changes-requested');
  });

  it('should parse CHANGES REQUESTED with bold markdown', () => {
    expect(parseReviewVerdict('**CHANGES REQUESTED**\n\nSome issues.')).toBe('changes-requested');
  });

  it('should parse APPROVED with markdown heading', () => {
    expect(parseReviewVerdict('# APPROVED\n\nLooks good.')).toBe('approve');
  });

  it('should parse APPROVED with bold markdown', () => {
    expect(parseReviewVerdict('**APPROVED**\n\nLooks good.')).toBe('approve');
  });

  it('should not treat NO CHANGES REQUESTED as a rejection', () => {
    expect(parseReviewVerdict('NO CHANGES REQUESTED\n\nAll good.')).toBe('approve');
  });

  it('should not treat NOT CHANGES REQUESTED as a rejection', () => {
    expect(parseReviewVerdict('NOT CHANGES REQUESTED\n\nAll good.')).toBe('approve');
  });

  it('should detect CHANGES REQUESTED on line 2 after a blank first line', () => {
    expect(parseReviewVerdict('\nCHANGES REQUESTED\n\nIssues found.')).toBe('changes-requested');
  });

  it('should detect CHANGES REQUESTED within the first 5 lines', () => {
    expect(parseReviewVerdict('Review Summary\nSession: test\n\nCHANGES REQUESTED\n\nDetails.')).toBe('changes-requested');
  });

  it('should not detect CHANGES REQUESTED beyond line 5', () => {
    expect(parseReviewVerdict('Line 1\nLine 2\nLine 3\nLine 4\nLine 5\nCHANGES REQUESTED')).toBe('approve');
  });

  it('should handle case-insensitive CHANGES REQUESTED', () => {
    expect(parseReviewVerdict('Changes Requested\n\nSome issues.')).toBe('changes-requested');
  });

  it('should approve on empty content', () => {
    expect(parseReviewVerdict('')).toBe('approve');
  });
});

describe('parseReviewFindings', () => {
  it('should parse architectural findings', () => {
    const findings = parseReviewFindings(CHANGES_REVIEW);
    const architectural = findings.filter(f => f.category === 'architectural');
    expect(architectural.length).toBeGreaterThanOrEqual(1);
  });

  it('should parse implementation findings', () => {
    const findings = parseReviewFindings(CHANGES_REVIEW);
    const implementation = findings.filter(f => f.category === 'implementation');
    expect(implementation.length).toBeGreaterThanOrEqual(1);
  });

  it('should return empty array for approved review with no findings', () => {
    const findings = parseReviewFindings(APPROVED_REVIEW);
    expect(findings).toEqual([]);
  });

  it('should include file references in findings', () => {
    const findings = parseReviewFindings(CHANGES_REVIEW);
    const withFile = findings.filter(f => f.file);
    expect(withFile.length).toBeGreaterThanOrEqual(1);
  });
});

describe('aggregateReviews', () => {
  it('should return approved when all reviewers approve', () => {
    const result = aggregateReviews([
      { reviewerName: 'carmack', content: APPROVED_REVIEW },
      { reviewerName: 'metz', content: APPROVED_REVIEW },
      { reviewerName: 'torvalds', content: APPROVED_REVIEW },
    ]);
    expect(result.approved).toBe(true);
    expect(result.architecturalFindings).toHaveLength(0);
    expect(result.implementationFindings).toHaveLength(0);
  });

  it('should return not approved when any reviewer requests changes', () => {
    const result = aggregateReviews([
      { reviewerName: 'carmack', content: APPROVED_REVIEW },
      { reviewerName: 'metz', content: CHANGES_REVIEW },
      { reviewerName: 'torvalds', content: APPROVED_REVIEW },
    ]);
    expect(result.approved).toBe(false);
  });

  it('should separate architectural and implementation findings', () => {
    const result = aggregateReviews([
      { reviewerName: 'carmack', content: CHANGES_REVIEW },
      { reviewerName: 'metz', content: MIXED_REVIEW },
      { reviewerName: 'torvalds', content: APPROVED_REVIEW },
    ]);
    expect(result.architecturalFindings.length).toBeGreaterThanOrEqual(1);
    expect(result.implementationFindings.length).toBeGreaterThanOrEqual(1);
  });

  it('should include all reviewer results', () => {
    const result = aggregateReviews([
      { reviewerName: 'carmack', content: APPROVED_REVIEW },
      { reviewerName: 'metz', content: CHANGES_REVIEW },
      { reviewerName: 'torvalds', content: MIXED_REVIEW },
    ]);
    expect(result.reviews).toHaveLength(3);
    const names = result.reviews.map(r => r.reviewer).sort();
    expect(names).toEqual(['carmack', 'metz', 'torvalds']);
  });

  it('should set correct verdict per reviewer', () => {
    const result = aggregateReviews([
      { reviewerName: 'carmack', content: APPROVED_REVIEW },
      { reviewerName: 'metz', content: CHANGES_REVIEW },
      { reviewerName: 'torvalds', content: APPROVED_REVIEW },
    ]);
    const carmack = result.reviews.find(r => r.reviewer === 'carmack')!;
    const metz = result.reviews.find(r => r.reviewer === 'metz')!;
    expect(carmack.verdict).toBe('approve');
    expect(metz.verdict).toBe('changes-requested');
  });
});

describe('determineFeedbackRoute', () => {
  function makeAggregate(overrides: Partial<ReturnType<typeof aggregateReviews>> = {}) {
    return {
      approved: true,
      architecturalFindings: [],
      implementationFindings: [],
      reviews: [],
      ...overrides,
    };
  }

  it('should return none when approved with no findings', () => {
    expect(determineFeedbackRoute(makeAggregate({ approved: true }))).toBe('none');
  });

  it('should return architectural when there are architectural findings', () => {
    expect(determineFeedbackRoute(makeAggregate({
      approved: false,
      architecturalFindings: [{ category: 'architectural', description: 'Bad design' }],
    }))).toBe('architectural');
  });

  it('should return implementation when there are only implementation findings', () => {
    expect(determineFeedbackRoute(makeAggregate({
      approved: false,
      implementationFindings: [{ category: 'implementation', description: 'Missing null check' }],
    }))).toBe('implementation');
  });

  it('should prioritize architectural over implementation when both present', () => {
    expect(determineFeedbackRoute(makeAggregate({
      approved: false,
      architecturalFindings: [{ category: 'architectural', description: 'Bad coupling' }],
      implementationFindings: [{ category: 'implementation', description: 'Bug' }],
    }))).toBe('architectural');
  });

  it('should return none when not approved but no categorized findings', () => {
    expect(determineFeedbackRoute(makeAggregate({
      approved: false,
    }))).toBe('none');
  });
});

describe('DEFAULT_SWARM_CONFIG', () => {
  it('should default to a single generic reviewer', () => {
    expect(DEFAULT_SWARM_CONFIG.defaultReviewers).toEqual(['reviewer']);
  });
});
