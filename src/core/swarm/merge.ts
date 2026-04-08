import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TaskLedger } from './types.js';
import { getSwarmDir } from './artifacts.js';

export type MergeOutcome = 'clean' | 'conflict-unresolvable';

export interface WorkerMergeResult {
  workerId: string;
  branch: string;
  outcome: MergeOutcome;
  error?: string;
}

export interface FanInResult {
  success: boolean;
  integrationBranch: string;
  workerMerges: WorkerMergeResult[];
  reportPath: string | null;
  error?: string;
}

export interface FanInOptions {
  repoRoot: string;
  sessionId: string;
  sessionName: string;
  workingDirectory: string;
  ledger: TaskLedger;
}

function mergeWorkerBranch(workingDirectory: string, workerId: string, branch: string): WorkerMergeResult {
  try {
    execFileSync('git', ['merge', branch, '--no-edit'], {
      cwd: workingDirectory,
      stdio: 'pipe',
    });
    return { workerId, branch, outcome: 'clean' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    try {
      execFileSync('git', ['merge', '--abort'], {
        cwd: workingDirectory,
        stdio: 'pipe',
      });
    } catch {
      // merge --abort may fail if there's nothing to abort
    }

    return {
      workerId,
      branch,
      outcome: 'conflict-unresolvable',
      error: message,
    };
  }
}

function buildMergeReport(integrationBranch: string, merges: WorkerMergeResult[]): string {
  const lines = ['# Merge Report', ''];
  lines.push(`**Integration branch:** ${integrationBranch}`);
  lines.push(`**Workers merged:** ${merges.length}`);
  lines.push('');

  for (const merge of merges) {
    const status = merge.outcome === 'clean' ? 'Clean' : `CONFLICT (${merge.outcome})`;
    lines.push(`## ${merge.workerId}`);
    lines.push(`- **Branch:** ${merge.branch}`);
    lines.push(`- **Status:** ${status}`);
    if (merge.error) {
      lines.push(`- **Error:** ${merge.error}`);
    }
    lines.push('');
  }

  const allClean = merges.every(m => m.outcome === 'clean');
  lines.push(allClean ? 'All merges completed cleanly.' : 'One or more merges had conflicts.');

  return lines.join('\n');
}

export function runFanIn(options: FanInOptions): FanInResult {
  const integrationBranch = `hydraz/${options.sessionName}`;
  const workerIds = Object.keys(options.ledger.workers);
  const workerMerges: WorkerMergeResult[] = [];

  try {
    execFileSync('git', ['checkout', '-B', integrationBranch, options.ledger.baseCommit], {
      cwd: options.workingDirectory,
      stdio: 'pipe',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      integrationBranch,
      workerMerges: [],
      reportPath: null,
      error: `Failed to create integration branch: ${message}`,
    };
  }

  let failed = false;
  for (const workerId of workerIds) {
    const workerInfo = options.ledger.workers[workerId]!;
    const result = mergeWorkerBranch(options.workingDirectory, workerId, workerInfo.branch);
    workerMerges.push(result);

    if (result.outcome === 'conflict-unresolvable') {
      failed = true;
      break;
    }
  }

  const reportContent = buildMergeReport(integrationBranch, workerMerges);
  const reportPath = join(getSwarmDir(options.repoRoot, options.sessionId), 'merge', 'report.md');
  writeFileSync(reportPath, reportContent, { mode: 0o600 });

  return {
    success: !failed,
    integrationBranch,
    workerMerges,
    reportPath,
    error: failed ? `Merge conflict: ${workerMerges.find(m => m.outcome !== 'clean')?.error}` : undefined,
  };
}
