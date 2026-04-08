import { EVIDENCE_DISCIPLINE } from './core-principles.js';

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

Review the plan against your architecture design. Consider:

1. **Design alignment**: Does the plan faithfully implement your architectural recommendations?
2. **Task decomposition**: Are the tasks decomposed correctly? Are there missing tasks or unnecessary ones?
3. **File ownership**: Is the ownership map reasonable? Are there overlaps or gaps?
4. **Interface contracts**: Are the contracts between workers clear and correct?
5. **Risks**: Does the plan introduce risks your design didn't anticipate?
6. **Acceptance criteria**: Are the criteria specific and testable?

## Your Output

If the plan is acceptable, write a short approval to \`${swarmDir ? swarmDir + `/architecture/feedback/round-${round}.md` : `swarm/architecture/feedback/round-${round}.md`}\` stating the plan is approved and noting any minor observations.

If the plan needs revision, write detailed feedback to \`${swarmDir ? swarmDir + `/architecture/feedback/round-${round}.md` : `swarm/architecture/feedback/round-${round}.md`}\` explaining:
- What specific issues need to be addressed
- Why they matter
- What changes you recommend

Start your feedback file with either \`APPROVED\` or \`CHANGES REQUESTED\` on the first line so the orchestrator can parse your verdict.
`;
}
