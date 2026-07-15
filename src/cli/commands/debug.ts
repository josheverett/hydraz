import { readFileSync } from 'node:fs';
import type { Command } from 'commander';
import { detectRepo } from '../../core/repo/detect.js';
import {
  findSessionByName,
  getActiveSessions,
  type SessionMetadata,
} from '../../core/sessions/index.js';
import { refreshSessionStatus } from '../../core/orchestration/index.js';
import { sshExec } from '../../core/providers/devpod.js';
import { shellEscape } from '../../core/shell.js';
import { redactSecrets } from '../../core/display/sanitize.js';
import type { CodexInvocationEvidence } from '../../core/codex/invocation.js';

export function registerDebugCommand(program: Command): void {
  program
    .command('debug')
    .description('Show prompt-safe Codex invocation and rollout diagnostics')
    .argument('[session]', 'Session name (uses the active session if omitted)')
    .action(async (sessionName?: string) => {
      const repo = detectRepo();
      if (!repo) {
        console.error('Not in a git repository.');
        return;
      }

      const selected = sessionName
        ? findSessionByName(repo.root, sessionName)
        : getActiveSessions(repo.root)[0];
      if (!selected) {
        console.error(
          sessionName
            ? `Session "${sessionName}" not found.`
            : 'No active session. Pass a session name to inspect completed work.',
        );
        return;
      }

      const session = refreshSessionStatus(selected.id, repo.root);
      const loaded = loadInvocationEvidence(session);
      renderDiagnostics(session, loaded.evidence, loaded.error);
    });
}

function loadInvocationEvidence(session: SessionMetadata): {
  evidence?: CodexInvocationEvidence;
  error?: string;
} {
  if (session.codex?.invocationEvidence) {
    return { evidence: session.codex.invocationEvidence };
  }
  const path = session.codex?.invocationPath;
  if (!path) {
    return { error: 'No invocation artifact path has been recorded.' };
  }

  try {
    const raw = session.executionTarget === 'local'
      ? readFileSync(path, 'utf8')
      : sshExec(`hydraz-${session.id}`, `cat ${shellEscape(path)}`);
    const parsed = JSON.parse(raw) as unknown;
    if (!isInvocationEvidence(parsed)) {
      return { error: 'Invocation artifact has an unsupported shape.' };
    }
    return { evidence: parsed };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function renderDiagnostics(
  session: SessionMetadata,
  evidence: CodexInvocationEvidence | undefined,
  evidenceError: string | undefined,
): void {
  safeLog(`\n  Session:      ${session.name}`);
  if (!evidence) {
    safeLog('  Invocation proof: unavailable');
    if (evidenceError) safeLog(`  Invocation note: ${evidenceError}`);
  } else {
    safeLog('  Invocation proof: proven');
    safeLog('  Proof scope:  exact non-prompt argv passed by Hydraz to Codex');
    safeLog(`  Mode:        ${evidence.mode}`);
    safeLog(`  Model:       ${evidence.requested.model}`);
    safeLog(`  Reasoning:   ${evidence.requested.reasoningEffort}`);
    safeLog(`  Speed:       ${evidence.requested.speed}`);
    safeLog(`  Fast mode:   ${evidence.normalized.fastMode}`);
    safeLog(`  Service tier: ${evidence.normalized.serviceTier}`);
    safeLog(`  Command:     ${evidence.command}`);
    safeLog(`  Argv:        ${JSON.stringify(evidence.args)}`);
    safeLog(`  Spawn state: ${evidence.spawnState}`);
    if (evidence.threadId) safeLog(`  Thread:      ${evidence.threadId}`);
    if (evidence.exitCode !== undefined) safeLog(`  Exit code:   ${evidence.exitCode}`);
  }

  const rollout = session.codex?.rolloutVerification;
  if (!rollout) {
    safeLog('  Codex self-recorded: unavailable');
  } else {
    safeLog(`  Codex self-recorded: ${rollout.status}`);
    safeLog(`  Model check: ${rollout.checks.model}`);
    safeLog(`  Reasoning check: ${rollout.checks.reasoningEffort}`);
    safeLog(`  Service tier check: ${rollout.checks.serviceTier}`);
    if (rollout.reason) safeLog(`  Rollout note: ${rollout.reason}`);
  }
  safeLog('  Backend routing: not externally verifiable by Hydraz');
  safeLog('');
}

function safeLog(message: string): void {
  console.log(redactSecrets(message));
}

function isInvocationEvidence(value: unknown): value is CodexInvocationEvidence {
  if (!isRecord(value) || value['version'] !== 1) return false;
  if (value['mode'] !== 'exec' && value['mode'] !== 'resume') return false;
  if (typeof value['command'] !== 'string') return false;
  if (
    !Array.isArray(value['args'])
    || !value['args'].every((arg) => typeof arg === 'string')
  ) return false;
  if (value['promptOmitted'] !== true || !isRecord(value['requested'])) return false;
  if (!isRecord(value['normalized'])) return false;
  if (
    typeof value['requested']['model'] !== 'string'
    || typeof value['requested']['reasoningEffort'] !== 'string'
    || typeof value['requested']['speed'] !== 'string'
  ) return false;
  if (
    typeof value['normalized']['fastMode'] !== 'boolean'
    || typeof value['normalized']['serviceTier'] !== 'string'
  ) return false;
  return typeof value['spawnState'] === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
