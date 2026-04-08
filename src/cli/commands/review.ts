import type { Command } from 'commander';
import { select } from '@inquirer/prompts';
import { detectRepo } from '../../core/repo/detect.js';
import {
  listSessions,
  findSessionByName,
  summarizeArtifacts,
  getArtifactStatus,
  loadArtifact,
  type SessionMetadata,
  type ArtifactSummary,
} from '../../core/sessions/index.js';
import { readEvents, formatEvent } from '../../core/events/index.js';
import { loadConfig } from '../../core/config/index.js';
import { describeAuthMode } from '../../core/providers/auth.js';

export function registerReviewCommand(program: Command): void {
  program
    .command('review')
    .description('Review-ready summary of a session\'s outcome')
    .argument('[session]', 'Session name (uses most recent if not provided)')
    .action(async (sessionName?: string) => {
      const repo = detectRepo();
      if (!repo) {
        console.error('Not in a git repository.');
        return;
      }

      let session: SessionMetadata | null = null;

      if (sessionName) {
        session = findSessionByName(repo.root, sessionName);
        if (!session) {
          console.error(`Session "${sessionName}" not found.`);
          return;
        }
      } else {
        const sessions = listSessions(repo.root);
        if (sessions.length === 0) {
          console.log('\nNo sessions to review.\n');
          return;
        }

        if (sessions.length === 1) {
          session = sessions[0];
        } else {
          const chosen = await select({
            message: 'Select session to review',
            choices: sessions.map((s) => ({
              name: `${s.name} [${s.state}] → ${s.branchName}`,
              value: s.id,
            })),
          });
          session = sessions.find((s) => s.id === chosen)!;
        }
      }

      renderReview(session, repo.root);
    });
}

function renderReview(session: SessionMetadata, repoRoot: string): void {
  const config = loadConfig();
  const artifacts = summarizeArtifacts(repoRoot, session.id);
  const events = readEvents(repoRoot, session.id);

  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║                     SESSION REVIEW                          ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  console.log(`  Session:       ${session.name}`);
  console.log(`  State:         ${formatState(session.state)}`);
  console.log(`  Branch:        ${session.branchName}`);
  console.log(`  Target:        ${session.executionTarget}`);
  console.log(`  Personas:      ${session.personas.join(', ')}`);
  console.log(`  Auth mode:     ${describeAuthMode(config)}`);
  console.log(`  Created:       ${formatTimestamp(session.createdAt)}`);
  console.log(`  Last updated:  ${formatTimestamp(session.updatedAt)}`);

  console.log('\n  ── Task ──');
  console.log(`  ${session.task}`);

  if (session.blockerMessage) {
    console.log('\n  ── Blocker ──');
    console.log(`  ${session.blockerMessage}`);
  }
  if (session.failureMessage) {
    console.log('\n  ── Failure ──');
    console.log(`  ${session.failureMessage}`);
  }

  console.log('\n  ── Artifacts ──');
  console.log(`  ${getArtifactStatus(artifacts)}`);
  renderArtifactTable(artifacts);

  const prDraft = loadArtifact(repoRoot, session.id, 'pr-draft.md');
  if (prDraft) {
    console.log('\n  ── PR Draft ──');
    console.log(indent(prDraft.trim(), '  '));
  }

  if (events.length > 0) {
    console.log('\n  ── Event Timeline ──');
    for (const event of events) {
      console.log(`    ${formatEvent(event)}`);
    }
  }

  console.log(`\n  Readiness: ${assessReadiness(session, artifacts)}`);
  console.log();
}

function renderArtifactTable(artifacts: ArtifactSummary[]): void {
  for (const a of artifacts) {
    const status = a.exists ? '✓' : '·';
    const detail = a.exists && a.preview ? ` — ${a.preview.slice(0, 60)}...` : '';
    console.log(`    ${status} ${a.file}${detail}`);
  }
}

function assessReadiness(session: SessionMetadata, artifacts: ArtifactSummary[]): string {
  if (session.state === 'completed') {
    const hasVerification = artifacts.find((a) => a.file === 'verification-report.md')?.exists;
    const hasPR = artifacts.find((a) => a.file === 'pr-draft.md')?.exists;
    if (hasVerification && hasPR) return 'Ready for PR';
    if (hasVerification) return 'Verified, PR draft pending';
    return 'Completed (review artifacts)';
  }
  if (session.state === 'blocked') return `Blocked — ${session.blockerMessage ?? 'unknown reason'}`;
  if (session.state === 'failed') return `Failed — ${session.failureMessage ?? 'unknown error'}`;
  if (session.state === 'stopped') return 'Stopped by user — can resume';
  return `In progress (${session.state})`;
}

function formatState(state: string): string {
  const icons: Record<string, string> = {
    completed: 'completed',
    blocked: 'BLOCKED',
    failed: 'FAILED',
    stopped: 'stopped',
    created: 'created',
    starting: 'starting...',
    investigating: 'investigating...',
    architecting: 'architecting...',
    planning: 'planning...',
    'architect-reviewing': 'reviewing plan...',
    'fanning-out': 'launching workers...',
    syncing: 'workers running...',
    merging: 'merging...',
    reviewing: 'review panel...',
    delivering: 'delivering...',
  };
  return icons[state] ?? state;
}

function formatTimestamp(iso: string): string {
  return iso.replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
}

function indent(text: string, prefix: string): string {
  return text.split('\n').map((line) => `${prefix}${line}`).join('\n');
}
