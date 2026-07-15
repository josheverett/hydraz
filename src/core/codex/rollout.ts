import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type RolloutCheck = 'matched' | 'mismatched' | 'unavailable';

export interface CodexRolloutVerification {
  status: 'matched' | 'mismatched' | 'unavailable';
  checkedAt: string;
  sourcePath?: string;
  observed?: {
    model?: string;
    reasoningEffort?: string;
    serviceTier?: string;
  };
  checks: {
    model: RolloutCheck;
    reasoningEffort: RolloutCheck;
    serviceTier: RolloutCheck;
  };
  reason?: string;
}

export interface VerifyCodexRolloutOptions {
  codexHome?: string;
  threadId?: string;
  expected: {
    model: string;
    reasoningEffort: string;
    serviceTier: 'priority' | 'default';
  };
}

export function verifyCodexRollout(
  options: VerifyCodexRolloutOptions,
): CodexRolloutVerification {
  const unavailable = (reason: string): CodexRolloutVerification => ({
    status: 'unavailable',
    checkedAt: new Date().toISOString(),
    checks: unavailableChecks(),
    reason,
  });
  if (!options.threadId) {
    return unavailable('Codex thread id was not reported.');
  }

  const codexHome = options.codexHome ?? process.env.CODEX_HOME ?? join(homedir(), '.codex');
  const sessionsRoot = join(codexHome, 'sessions');
  const sourcePath = findRolloutPath(sessionsRoot, options.threadId);
  if (!sourcePath) {
    return unavailable(`No rollout file found for thread ${options.threadId}.`);
  }

  let content: string;
  try {
    content = readFileSync(sourcePath, 'utf8');
  } catch (error) {
    return unavailable(`Unable to read rollout: ${errorMessage(error)}`);
  }

  const observed = latestTurnContext(content);
  if (!observed) {
    return {
      ...unavailable('No readable turn_context item found in rollout.'),
      sourcePath,
    };
  }

  const checks = {
    model: compare(observed.model, options.expected.model),
    reasoningEffort: compare(
      observed.reasoningEffort,
      options.expected.reasoningEffort,
    ),
    serviceTier: compare(observed.serviceTier, options.expected.serviceTier),
  };
  return {
    status: Object.values(checks).includes('mismatched') ? 'mismatched' : 'matched',
    checkedAt: new Date().toISOString(),
    sourcePath,
    observed,
    checks,
  };
}

function findRolloutPath(sessionsRoot: string, threadId: string): string | undefined {
  if (!existsSync(sessionsRoot)) return undefined;

  const matches: string[] = [];
  const visit = (directory: string): void => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(path);
      } else if (
        entry.isFile()
        && entry.name.endsWith('.jsonl')
        && entry.name.includes(threadId)
      ) {
        matches.push(path);
      }
    }
  };
  visit(sessionsRoot);

  return matches
    .map((path) => ({ path, modifiedAt: safeMtime(path) }))
    .sort((a, b) => b.modifiedAt - a.modifiedAt)[0]?.path;
}

function latestTurnContext(content: string): NonNullable<
  CodexRolloutVerification['observed']
> | undefined {
  let latest: NonNullable<CodexRolloutVerification['observed']> | undefined;
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      const item = JSON.parse(line) as Record<string, unknown>;
      if (item['type'] !== 'turn_context' || !isRecord(item['payload'])) continue;
      const payload = item['payload'];
      const model = stringValue(payload['model']);
      const reasoningEffort = stringValue(payload['effort']);
      const serviceTier = stringValue(
        payload['service_tier'] ?? payload['serviceTier'],
      );
      if (!model && !reasoningEffort && !serviceTier) continue;
      latest = {
        ...(model ? { model } : {}),
        ...(reasoningEffort ? { reasoningEffort } : {}),
        ...(serviceTier ? { serviceTier } : {}),
      };
    } catch {
      // A malformed line does not invalidate other rollout evidence.
    }
  }
  return latest;
}

function compare(actual: string | undefined, expected: string): RolloutCheck {
  if (actual === undefined) return 'unavailable';
  return actual === expected ? 'matched' : 'mismatched';
}

function unavailableChecks(): CodexRolloutVerification['checks'] {
  return {
    model: 'unavailable',
    reasoningEffort: 'unavailable',
    serviceTier: 'unavailable',
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function safeMtime(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
