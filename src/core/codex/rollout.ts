import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type RolloutCheck = 'matched' | 'mismatched' | 'unavailable';

export interface CodexRolloutVerification {
  attemptId?: string;
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

export interface CodexRolloutCheckpoint {
  sourcePath?: string;
  byteLength: number;
  error?: string;
}

export interface VerifyCodexRolloutOptions {
  attemptId: string;
  codexHome?: string;
  threadId?: string;
  checkpoint?: CodexRolloutCheckpoint;
  expected: {
    model: string;
    reasoningEffort: string;
    serviceTier: 'priority' | 'default';
  };
}

export function captureCodexRolloutCheckpoint(options: {
  codexHome?: string;
  threadId: string;
}): CodexRolloutCheckpoint {
  const codexHome = options.codexHome ?? process.env.CODEX_HOME ?? join(homedir(), '.codex');
  const sourcePath = findRolloutPath(join(codexHome, 'sessions'), options.threadId);
  if (!sourcePath) {
    return { byteLength: 0 };
  }
  try {
    return {
      sourcePath,
      byteLength: statSync(sourcePath).size,
    };
  } catch (error) {
    return {
      sourcePath,
      byteLength: 0,
      error: `Unable to checkpoint rollout: ${errorMessage(error)}`,
    };
  }
}

export function verifyCodexRollout(
  options: VerifyCodexRolloutOptions,
): CodexRolloutVerification {
  const unavailable = (
    reason: string,
    sourcePath?: string,
  ): CodexRolloutVerification => ({
    attemptId: options.attemptId,
    status: 'unavailable',
    checkedAt: new Date().toISOString(),
    checks: unavailableChecks(),
    reason,
    ...(sourcePath ? { sourcePath } : {}),
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
  if (options.checkpoint?.error) {
    return unavailable(options.checkpoint.error, sourcePath);
  }
  if (
    options.checkpoint?.sourcePath
    && options.checkpoint.sourcePath !== sourcePath
  ) {
    return unavailable('Codex rollout source changed after the attempt began.', sourcePath);
  }

  let contentBuffer: Buffer;
  try {
    contentBuffer = readFileSync(sourcePath);
  } catch (error) {
    return unavailable(`Unable to read rollout: ${errorMessage(error)}`, sourcePath);
  }
  const checkpointLength = options.checkpoint?.sourcePath
    ? options.checkpoint.byteLength
    : 0;
  if (contentBuffer.byteLength < checkpointLength) {
    return unavailable('Codex rollout source shrank after the attempt began.', sourcePath);
  }
  const content = contentBuffer.subarray(checkpointLength).toString('utf8');

  const parsed = latestTurnContext(content);
  if (parsed.error) {
    return unavailable(parsed.error, sourcePath);
  }
  if (!parsed.observed) {
    return unavailable(
      options.checkpoint
        ? 'No new turn_context item found after rollout checkpoint.'
        : 'No readable turn_context item found in rollout.',
      sourcePath,
    );
  }

  const checks = {
    model: compare(parsed.observed.model, options.expected.model),
    reasoningEffort: compare(
      parsed.observed.reasoningEffort,
      options.expected.reasoningEffort,
    ),
    serviceTier: compare(parsed.observed.serviceTier, options.expected.serviceTier),
  };
  const requiredUnavailable = checks.model === 'unavailable'
    || checks.reasoningEffort === 'unavailable';
  return {
    attemptId: options.attemptId,
    status: requiredUnavailable
      ? 'unavailable'
      : Object.values(checks).includes('mismatched')
        ? 'mismatched'
        : 'matched',
    checkedAt: new Date().toISOString(),
    sourcePath,
    observed: parsed.observed,
    checks,
    ...(requiredUnavailable
      ? { reason: 'Rollout turn_context is missing required model and reasoning effort evidence.' }
      : {}),
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

function latestTurnContext(content: string): {
  observed?: NonNullable<CodexRolloutVerification['observed']>;
  error?: string;
} {
  let latest: NonNullable<CodexRolloutVerification['observed']> | undefined;
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    let item: Record<string, unknown>;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (!isRecord(parsed)) {
        return { error: 'Malformed rollout record: expected a JSON object.' };
      }
      item = parsed;
    } catch {
      return { error: 'Malformed rollout JSON encountered in attempt output.' };
    }
    if (item['type'] !== 'turn_context') continue;
    if (!isRecord(item['payload'])) {
      return { error: 'Malformed turn_context record: payload is not an object.' };
    }
    const payload = item['payload'];
    const model = optionalString(payload, 'model');
    const reasoningEffort = optionalString(payload, 'effort');
    const serviceTier = optionalString(
      payload,
      'service_tier',
      'serviceTier',
    );
    if (model.error || reasoningEffort.error || serviceTier.error) {
      return {
        error: model.error ?? reasoningEffort.error ?? serviceTier.error,
      };
    }
    latest = {
      ...(model.value ? { model: model.value } : {}),
      ...(reasoningEffort.value
        ? { reasoningEffort: reasoningEffort.value }
        : {}),
      ...(serviceTier.value ? { serviceTier: serviceTier.value } : {}),
    };
  }
  return { observed: latest };
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

function optionalString(
  value: Record<string, unknown>,
  key: string,
  alternateKey?: string,
): { value?: string; error?: string } {
  const selectedKey = key in value
    ? key
    : alternateKey && alternateKey in value
      ? alternateKey
      : undefined;
  if (!selectedKey) return {};
  const selected = value[selectedKey];
  if (typeof selected !== 'string') {
    return { error: `Malformed turn_context record: "${selectedKey}" must be a string.` };
  }
  const trimmed = selected.trim();
  return trimmed ? { value: trimmed } : {};
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
