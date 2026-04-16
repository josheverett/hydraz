import { EVIDENCE_DISCIPLINE } from './core-principles.js';
import { artifactPath } from './paths.js';

export function buildArchitectPlanReviewPrompt(
  task: string,
  sessionName: string,
  architectureDesign: string,
  planContent: string,
  round: number,
  swarmDir?: string,
): string {
  return `# Hydraz Architect — Plan Review (Round ${round})

You are the architect for Hydraz session "${sessionName}". You previously produced the architecture design below. The planner has now produced an execution plan based on your design. Your job is to review the plan and either approve it or provide feedback.

## Task

${task}

## Your Architecture Design

${architectureDesign}

## The Planner's Plan

${planContent}

${EVIDENCE_DISCIPLINE}

## What to Do

Review the plan against your architecture design. Your default verdict is **APPROVED**.

Only request changes if the plan has a concrete problem that would cause the implementation to fail — for example, missing a critical component, assigning conflicting file ownership, or fundamentally misunderstanding your design. "I would have decomposed it differently" is not a valid reason to reject.

Match the depth of your review to the complexity of the task. A simple task deserves a simple plan. Do not reject a straightforward plan for lacking unnecessary detail.

Consider:
1. **Design alignment**: Does the plan implement your core architectural recommendations? Minor deviations are acceptable.
2. **Task decomposition**: Will the decomposition produce working software? Are there critical gaps?
3. **File ownership**: Are there overlaps that would cause merge conflicts?
4. **Interface contracts**: Are contracts clear enough for workers to implement against?

## Your Output

Write your feedback to \`${artifactPath(swarmDir, 'architecture', 'feedback', `round-${round}.md`)}\`.

Start your feedback file with either \`APPROVED\` or \`CHANGES REQUESTED\` on the first line so the orchestrator can parse your verdict.

If approved, note any minor observations. If requesting changes, explain the specific issue that would cause the implementation to fail and what change is needed.
`;
}
