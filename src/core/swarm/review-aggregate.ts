import type { ReviewAggregate, ReviewFinding, ReviewResult, ReviewVerdict } from './types.js';

export function parseReviewVerdict(reviewContent: string): ReviewVerdict {
  const firstLine = reviewContent.split('\n')[0]?.trim().toUpperCase() ?? '';
  if (firstLine.startsWith('APPROVED')) return 'approve';
  return 'changes-requested';
}

export function parseReviewFindings(reviewContent: string): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const lines = reviewContent.split('\n');

  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!.trim();

    if (line.startsWith('- Category:')) {
      const category = line.replace('- Category:', '').trim().toLowerCase();
      if (category !== 'architectural' && category !== 'implementation') {
        i++;
        continue;
      }

      const finding: ReviewFinding = {
        category: category as 'architectural' | 'implementation',
        description: '',
      };

      i++;
      while (i < lines.length) {
        const nextLine = lines[i]!.trim();
        if (nextLine.startsWith('- Category:') || nextLine.startsWith('## ')) break;

        if (nextLine.startsWith('File:')) {
          finding.file = nextLine.replace('File:', '').trim();
        } else if (nextLine.startsWith('Description:')) {
          finding.description = nextLine.replace('Description:', '').trim();
        }
        i++;
      }

      findings.push(finding);
      continue;
    }

    i++;
  }

  return findings;
}

export function aggregateReviews(
  reviews: Array<{ reviewerName: string; content: string }>,
): ReviewAggregate {
  const reviewResults: ReviewResult[] = [];
  const allArchitectural: ReviewFinding[] = [];
  const allImplementation: ReviewFinding[] = [];

  for (const review of reviews) {
    const verdict = parseReviewVerdict(review.content);
    const findings = parseReviewFindings(review.content);

    reviewResults.push({
      reviewer: review.reviewerName,
      verdict,
      findings,
      summary: review.content,
    });

    for (const finding of findings) {
      if (finding.category === 'architectural') {
        allArchitectural.push(finding);
      } else {
        allImplementation.push(finding);
      }
    }
  }

  const approved = reviewResults.every(r => r.verdict === 'approve');

  return {
    approved,
    architecturalFindings: allArchitectural,
    implementationFindings: allImplementation,
    reviews: reviewResults,
  };
}

export type FeedbackRoute = 'architectural' | 'implementation' | 'none';

export function determineFeedbackRoute(aggregate: ReviewAggregate): FeedbackRoute {
  if (aggregate.approved) return 'none';
  if (aggregate.architecturalFindings.length > 0) return 'architectural';
  if (aggregate.implementationFindings.length > 0) return 'implementation';
  return 'none';
}
