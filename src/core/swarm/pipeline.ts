import type { SwarmPhase, TaskLedger, OwnershipMap, ExecutionContext } from './types.js';
import type { HydrazConfig } from '../config/schema.js';
import type { ExecutorResult } from '../claude/executor.js';
import { runInvestigation } from './investigator.js';
import { runArchitect } from './architect.js';
import { runConsensus } from './consensus.js';
import { runWorkerFanout } from './workers.js';
import { runFanIn } from './merge.js';
import { runReviewPanel } from './reviewer.js';
import { aggregateReviews, determineFeedbackRoute, parseReviewFindings } from './review-aggregate.js';
import {
  readInvestigationBrief,
  readArchitectureDesign,
  readPlan,
  readReviewFile,
  readWorkerProgress,
  getSwarmDir,
} from './artifacts.js';
import { getWorkspaceDir } from '../providers/provider.js';
import { readRepoPromptContent } from './repo-config.js';

export interface PipelineCallbacks {
  onPhaseChange?: (phase: SwarmPhase) => void;
  onEvent?: (type: string, message: string) => void;
  onError?: (message: string) => void;
}

export interface PipelineResult {
  success: boolean;
  phase: SwarmPhase;
  outerLoopsUsed: number;
  consensusRoundsUsed: number;
  approved: boolean;
  error?: string;
}

export interface PipelineOptions {
  repoRoot: string;
  sessionId: string;
  sessionName: string;
  task: string;
  workingDirectory: string;
  config: HydrazConfig;
  workerCount: number;
  reviewerPersonas: Array<{ name: string; persona: string }>;
  maxOuterLoops: number;
  maxConsensusRounds: number;
  parallel: boolean;
  verbose?: boolean;
  callbacks?: PipelineCallbacks;
}

function emitPhase(options: PipelineOptions, phase: SwarmPhase): void {
  options.callbacks?.onPhaseChange?.(phase);
}

function emitEvent(options: PipelineOptions, type: string, message: string): void {
  options.callbacks?.onEvent?.(type, message);
}

function emitVerbose(options: PipelineOptions, type: string, message: string): void {
  if (!options.verbose) return;
  options.callbacks?.onEvent?.(`verbose.${type}`, message);
}

function formatExecutorMetrics(label: string, r: ExecutorResult | null | undefined): string {
  if (!r) return `${label}: no executor result`;
  const cost = r.cost != null ? `$${r.cost.toFixed(2)}` : 'n/a';
  const tokensIn = r.inputTokens != null ? `${(r.inputTokens / 1000).toFixed(1)}k in` : '';
  const tokensOut = r.outputTokens != null ? `${(r.outputTokens / 1000).toFixed(1)}k out` : '';
  const tokens = [tokensIn, tokensOut].filter(Boolean).join('/');
  const dur = r.durationMs != null ? `${Math.round(r.durationMs / 1000)}s` : 'n/a';
  return `${label}: ${cost}, ${tokens || 'n/a tokens'}, ${dur}, exit ${r.exitCode ?? '?'}`;
}

export function extractReviewSummary(content: string): string | null {
  const lines = content.split('\n');
  let inSummary = false;
  const summaryLines: string[] = [];
  for (const line of lines) {
    if (/^##\s+Summary\b/.test(line)) {
      inSummary = true;
      continue;
    }
    if (inSummary && /^##\s/.test(line)) break;
    if (inSummary) summaryLines.push(line);
  }
  const text = summaryLines.join('\n').trim();
  return text || null;
}

function emitCostRunning(options: PipelineOptions, cost: number, count: number): void {
  emitVerbose(options, 'cost_running', `Running total: $${cost.toFixed(2)} (${count} invocations)`);
  if (cost > COST_WARNING_THRESHOLD) {
    emitVerbose(options, 'warning', `Running cost $${cost.toFixed(2)} exceeds $${COST_WARNING_THRESHOLD.toFixed(2)} threshold`);
  }
}

function excerptLines(content: string, maxLines = 5): string {
  const lines = content.split('\n').slice(0, maxLines);
  const truncated = content.split('\n').length > maxLines;
  return lines.join('\n') + (truncated ? '\n...' : '');
}

function buildContext(options: PipelineOptions, swarmDir: string): ExecutionContext {
  const repoPrompt = readRepoPromptContent(options.repoRoot);
  return {
    repoRoot: options.repoRoot,
    sessionId: options.sessionId,
    sessionName: options.sessionName,
    task: options.task,
    workingDirectory: options.workingDirectory,
    config: options.config,
    swarmDir,
    repoPromptContent: repoPrompt ?? undefined,
  };
}

const COST_WARNING_THRESHOLD = 5.0;

export async function runSwarmPipeline(options: PipelineOptions): Promise<PipelineResult> {
  let investigationBrief: string;
  let architectureDesign: string;
  let planContent: string;
  let ledger: TaskLedger;
  let ownership: OwnershipMap;
  let totalConsensusRounds = 0;
  let workerWorktrees: Record<string, string> | undefined;
  let reviewFeedback: string | undefined;
  const swarmDir = getSwarmDir(options.repoRoot, options.sessionId);
  const ctx = buildContext(options, swarmDir);
  let runningCost = 0;
  let invocationCount = 0;

  emitPhase(options, 'investigating');
  emitEvent(options, 'swarm.investigate_started', 'Investigation starting');

  const investigationResult = await runInvestigation(ctx);

  if (investigationResult.executorResult) {
    runningCost += investigationResult.executorResult.cost ?? 0;
    invocationCount++;
    emitVerbose(options, 'executor_metrics', formatExecutorMetrics('Investigation', investigationResult.executorResult));
    emitCostRunning(options, runningCost, invocationCount);
    if (investigationResult.executorResult.stderr) {
      emitVerbose(options, 'stderr', `Investigation stderr: ${investigationResult.executorResult.stderr}`);
    }
  }

  if (!investigationResult.success) {
    return {
      success: false,
      phase: 'investigating',
      outerLoopsUsed: 0,
      consensusRoundsUsed: 0,
      approved: false,
      error: investigationResult.error,
    };
  }

  investigationBrief = readInvestigationBrief(options.repoRoot, options.sessionId) ?? '';
  emitEvent(options, 'swarm.investigate_completed', 'Investigation complete');
  if (investigationBrief) {
    emitVerbose(options, 'investigation', `Brief excerpt (first 5 lines):\n${excerptLines(investigationBrief)}`);
  } else {
    emitVerbose(options, 'warning', 'Investigation brief is empty or missing');
  }

  emitPhase(options, 'architecting');
  emitEvent(options, 'swarm.architect_started', 'Architecture starting');

  const architectResult = await runArchitect(ctx, { investigationBrief });

  if (architectResult.executorResult) {
    runningCost += architectResult.executorResult.cost ?? 0;
    invocationCount++;
    emitVerbose(options, 'executor_metrics', formatExecutorMetrics('Architecture', architectResult.executorResult));
    emitCostRunning(options, runningCost, invocationCount);
    if (architectResult.executorResult.stderr) {
      emitVerbose(options, 'stderr', `Architecture stderr: ${architectResult.executorResult.stderr}`);
    }
  }

  if (!architectResult.success) {
    return {
      success: false,
      phase: 'architecting',
      outerLoopsUsed: 0,
      consensusRoundsUsed: 0,
      approved: false,
      error: architectResult.error,
    };
  }

  architectureDesign = readArchitectureDesign(options.repoRoot, options.sessionId) ?? '';
  emitEvent(options, 'swarm.architect_completed', 'Architecture complete');
  if (architectureDesign) {
    emitVerbose(options, 'architecture', `Design excerpt (first 5 lines):\n${excerptLines(architectureDesign)}`);
  } else {
    emitVerbose(options, 'warning', 'Architecture design is empty or missing');
  }

  for (let outerLoop = 0; outerLoop < options.maxOuterLoops; outerLoop++) {
    if (outerLoop > 0) {
      const prevReviewExcerpt = reviewFeedback ? excerptLines(reviewFeedback, 2) : '(no feedback)';
      emitVerbose(options, 'outer_loop', `Starting outer loop ${outerLoop + 1}. Previous review feedback excerpt:\n${prevReviewExcerpt}`);
    }

    emitPhase(options, 'planning');
    emitEvent(options, 'swarm.plan_started', `Planning (outer loop ${outerLoop + 1})`);

    const consensusResult = await runConsensus(ctx, {
      investigationBrief,
      architectureDesign,
      workerCount: options.workerCount,
      maxRounds: options.maxConsensusRounds,
      reviewFeedback,
      verbose: options.verbose,
      onEvent: (type, message) => {
        if (type.startsWith('verbose.')) {
          if (options.verbose) options.callbacks?.onEvent?.(type, message);
        } else {
          emitEvent(options, type, message);
        }
      },
    });

    totalConsensusRounds += consensusResult.roundsUsed;

    if (!consensusResult.success) {
      return {
        success: false,
        phase: 'planning',
        outerLoopsUsed: outerLoop + 1,
        consensusRoundsUsed: totalConsensusRounds,
        approved: false,
        error: consensusResult.error,
      };
    }

    ledger = consensusResult.finalLedger!;
    ownership = consensusResult.finalOwnership!;
    planContent = readPlan(options.repoRoot, options.sessionId) ?? '';
    emitEvent(options, 'swarm.consensus_round', `Consensus used ${consensusResult.roundsUsed} round(s)`);
    emitEvent(options, 'swarm.plan_completed', `Consensus reached in ${consensusResult.roundsUsed} rounds`);

    if (planContent) {
      emitVerbose(options, 'plan_summary', `Plan excerpt (first 5 lines):\n${excerptLines(planContent)}`);
    } else {
      emitVerbose(options, 'warning', 'Plan content is empty or missing');
    }

    const taskCount = ledger.tasks.length;
    const workerIds = Object.keys(ledger.workers);
    const ledgerSummary = ledger.tasks.map(t =>
      `${t.id}: "${t.title}" → ${t.assignedWorker} [${t.status}]`
    ).join('\n');
    emitVerbose(options, 'plan_ledger', `Task ledger: ${taskCount} task(s), ${workerIds.length} worker(s)\n${ledgerSummary}`);

    emitPhase(options, 'architect-reviewing');
    emitPhase(options, 'fanning-out');
    emitEvent(options, 'swarm.worker_launched', `Launching ${options.workerCount} workers`);

    const workerResult = await runWorkerFanout(ctx, {
      ledger,
      ownership,
      planContent,
      existingWorktrees: workerWorktrees,
      parallel: options.parallel,
    });

    if (!workerWorktrees) {
      workerWorktrees = {};
      for (const wr of workerResult.workerResults) {
        workerWorktrees[wr.workerId] = getWorkspaceDir(options.repoRoot, `${options.sessionId}-${wr.workerId}`);
      }
    }

    for (const wr of workerResult.workerResults) {
      if (wr.executorResult) {
        runningCost += wr.executorResult.cost ?? 0;
        invocationCount++;
        emitVerbose(options, 'executor_metrics', formatExecutorMetrics(`Worker ${wr.workerId}`, wr.executorResult));
      }
      if (wr.success) {
        emitEvent(options, 'swarm.worker_completed', `Worker ${wr.workerId} completed`);
      } else {
        emitEvent(options, 'swarm.worker_failed', `Worker ${wr.workerId} failed`);
      }

      const cost = wr.executorResult?.cost != null ? `$${wr.executorResult.cost.toFixed(2)}` : 'n/a';
      const progress = readWorkerProgress(options.repoRoot, options.sessionId, wr.workerId);
      const progressExcerpt = progress ? excerptLines(progress, 3) : '(no progress file)';
      emitVerbose(options, 'worker_detail', `Worker ${wr.workerId}: exit ${wr.executorResult?.exitCode ?? '?'}, cost ${cost}\nProgress excerpt: "${progressExcerpt}"`);

      if (wr.executorResult?.stderr) {
        emitVerbose(options, 'stderr', `Worker ${wr.workerId} stderr: ${wr.executorResult.stderr}`);
      }
    }
    emitCostRunning(options, runningCost, invocationCount);

    emitPhase(options, 'syncing');

    if (!workerResult.success) {
      return {
        success: false,
        phase: 'syncing',
        outerLoopsUsed: outerLoop + 1,
        consensusRoundsUsed: totalConsensusRounds,
        approved: false,
        error: workerResult.error,
      };
    }

    emitPhase(options, 'merging');
    emitEvent(options, 'swarm.merge_started', 'Merging worker branches');

    const mergeResult = runFanIn({
      repoRoot: options.repoRoot,
      sessionId: options.sessionId,
      sessionName: options.sessionName,
      workingDirectory: options.workingDirectory,
      ledger,
    });

    if (!mergeResult.success) {
      emitEvent(options, 'swarm.merge_conflict', `Merge conflict: ${mergeResult.error}`);
      return {
        success: false,
        phase: 'merging',
        outerLoopsUsed: outerLoop + 1,
        consensusRoundsUsed: totalConsensusRounds,
        approved: false,
        error: mergeResult.error,
      };
    }

    emitEvent(options, 'swarm.merge_completed', 'Merge complete');

    const cleanCount = mergeResult.workerMerges.filter((m: { outcome: string }) => m.outcome === 'clean').length;
    const conflictCount = mergeResult.workerMerges.filter((m: { outcome: string }) => m.outcome !== 'clean').length;
    emitVerbose(options, 'merge_detail', `Merge: ${cleanCount} worker branch(es) merged cleanly, ${conflictCount} conflict(s)`);

    emitPhase(options, 'reviewing');
    emitEvent(options, 'swarm.review_started', 'Review panel starting');

    const reviewResult = await runReviewPanel(ctx, {
      planContent,
      architectureDesign,
      reviewerPersonas: options.reviewerPersonas,
    });

    if (!reviewResult.success) {
      return {
        success: false,
        phase: 'reviewing',
        outerLoopsUsed: outerLoop + 1,
        consensusRoundsUsed: totalConsensusRounds,
        approved: false,
        error: 'Review panel failed',
      };
    }

    for (const rr of reviewResult.reviews) {
      if (rr.executorResult) {
        runningCost += rr.executorResult.cost ?? 0;
        invocationCount++;
        emitVerbose(options, 'executor_metrics', formatExecutorMetrics(`Reviewer ${rr.reviewerName}`, rr.executorResult));
        if (rr.executorResult.stderr) {
          emitVerbose(options, 'stderr', `Reviewer ${rr.reviewerName} stderr: ${rr.executorResult.stderr}`);
        }
      }
    }
    emitCostRunning(options, runningCost, invocationCount);

    const reviewContents = reviewResult.reviews.map(r => ({
      reviewerName: r.reviewerName,
      content: readReviewFile(options.repoRoot, options.sessionId, r.reviewerName) ?? '',
    }));
    const aggregate = aggregateReviews(reviewContents);
    emitEvent(options, 'swarm.review_completed', `Review complete: ${aggregate.approved ? 'approved' : 'changes requested'}`);

    for (const rc of reviewContents) {
      if (!rc.content) {
        emitVerbose(options, 'warning', `Review file for "${rc.reviewerName}" is empty or missing — Claude may have failed silently`);
        continue;
      }

      const firstLine = rc.content.split('\n')[0] ?? '';
      emitVerbose(options, 'review_raw_line1', `Raw first line of review file for "${rc.reviewerName}": "${firstLine}"`);

      const reviewerVerdict = aggregate.reviews.find(r => r.reviewer === rc.reviewerName)?.verdict ?? 'unknown';
      emitVerbose(options, 'review_verdict', `Reviewer "${rc.reviewerName}": verdict=${reviewerVerdict}, first_line="${firstLine}"`);

      const findings = parseReviewFindings(rc.content);
      const archCount = findings.filter(f => f.category === 'architectural').length;
      const implCount = findings.filter(f => f.category === 'implementation').length;
      emitVerbose(options, 'review_findings', `Reviewer "${rc.reviewerName}": ${archCount} architectural, ${implCount} implementation findings parsed`);

      if (reviewerVerdict === 'changes-requested' && archCount === 0 && implCount === 0) {
        emitVerbose(options, 'warning', `Verdict is CHANGES REQUESTED but 0 structured findings were parsed for "${rc.reviewerName}" — the reviewer likely did not use the expected "- Category:" format. The planner will receive the raw review text but no structured routing.`);
      }

      const summary = extractReviewSummary(rc.content);
      if (summary) {
        emitVerbose(options, 'review_summary', `Reviewer "${rc.reviewerName}" summary: "${summary}"`);
      } else {
        emitVerbose(options, 'review_summary', `Reviewer "${rc.reviewerName}": no ## Summary section found in review output`);
      }

      emitVerbose(options, 'review_content', `=== Full review from "${rc.reviewerName}" ===\n${rc.content}\n=== End review ===`);
    }

    if (aggregate.approved) {
      return {
        success: true,
        phase: 'completed',
        outerLoopsUsed: outerLoop + 1,
        consensusRoundsUsed: totalConsensusRounds,
        approved: true,
      };
    }

    const route = determineFeedbackRoute(aggregate);
    const routeReason = aggregate.approved
      ? 'approved'
      : aggregate.architecturalFindings.length === 0 && aggregate.implementationFindings.length === 0
        ? 'no categorized findings despite rejection'
        : aggregate.architecturalFindings.length > 0
          ? `${aggregate.architecturalFindings.length} architectural finding(s) detected`
          : `${aggregate.implementationFindings.length} implementation finding(s) detected`;
    emitEvent(options, 'swarm.review_feedback', `Feedback route: ${route}`);
    emitVerbose(options, 'review_route', `Feedback route: ${route} (reason: ${routeReason})`);
    emitEvent(options, 'swarm.outer_loop', `Outer loop ${outerLoop + 2}`);

    reviewFeedback = reviewContents
      .map(r => `### ${r.reviewerName}\n\n${r.content}`)
      .join('\n\n');

    if (route === 'architectural') {
      architectureDesign = readArchitectureDesign(options.repoRoot, options.sessionId) ?? architectureDesign;
    }
  }

  return {
    success: false,
    phase: 'blocked',
    outerLoopsUsed: options.maxOuterLoops,
    consensusRoundsUsed: totalConsensusRounds,
    approved: false,
    error: `Outer loop exhausted after ${options.maxOuterLoops} iterations`,
  };
}
