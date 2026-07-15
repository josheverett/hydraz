import type { Command } from 'commander';
import { detectRepo } from '../../core/repo/detect.js';
import {
  findSessionByName,
  getActiveSessions,
  type SessionMetadata,
} from '../../core/sessions/index.js';
import { refreshSessionStatus } from '../../core/orchestration/index.js';

export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Show a human-readable summary of session state')
    .argument('[session]', 'Session name (uses active session if not provided)')
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
        const active = getActiveSessions(repo.root);
        if (active.length === 0) {
          console.log('\nNo active sessions.\n');
          return;
        }
        session = active[0];
      }

      const selected = session;
      session = refreshSessionStatus(selected.id, repo.root);
      renderStatus(session);
    });
}

function renderStatus(session: SessionMetadata): void {
  console.log(`\n  Session:    ${session.name}`);
  console.log(`  Branch:     ${session.branchName}`);
  console.log(`  State:      ${session.state}`);
  console.log(`  Target:     ${session.executionTarget}`);
  console.log(`  Goal:       ${truncate(session.task, 80)}`);
  console.log(`  Created:    ${session.createdAt}`);
  console.log(`  Updated:    ${session.updatedAt}`);
  if (session.codex?.threadId) {
    console.log(`  Codex:      ${session.codex.threadId}`);
  }
  if (session.codex?.remotePid) {
    console.log(`  Runner PID: ${session.codex.remotePid}`);
  }
  if (session.codex?.requestedConfig) {
    console.log(`  Codex model: ${session.codex.requestedConfig.model}`);
    console.log(`  Reasoning:   ${session.codex.requestedConfig.reasoningEffort}`);
    console.log(`  Speed:       ${session.codex.requestedConfig.speed}`);
  }
  if (session.codex?.invocationPath) {
    console.log(`  Invocation:  ${session.codex.invocationPath}`);
  }
  if (session.codex?.rolloutVerification) {
    const verification = session.codex.rolloutVerification;
    console.log(`  Rollout:     ${verification.status}`);
    console.log(`  Model check: ${verification.checks.model}`);
    console.log(`  Effort check: ${verification.checks.reasoningEffort}`);
    console.log(`  Tier check:  ${verification.checks.serviceTier}`);
    if (verification.reason) {
      console.log(`  Rollout note: ${verification.reason}`);
    }
  }

  if (session.blockerMessage) {
    console.log(`  Blocker:    ${session.blockerMessage}`);
  }
  if (session.failureMessage) {
    console.log(`  Failure:    ${session.failureMessage}`);
  }
  console.log();
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + '...';
}
