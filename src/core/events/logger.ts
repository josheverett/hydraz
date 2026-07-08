import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { redactSecrets, sanitizeInlineTerminalText } from '../display/sanitize.js';
import { getSessionDir } from '../sessions/manager.js';

export interface HydrazEvent {
  timestamp: string;
  sessionId: string;
  type: string;
  state?: string;
  message: string;
  metadata?: Record<string, unknown>;
}

export type EventType =
  | 'session.created'
  | 'session.attached'
  | 'session.state_changed'
  | 'session.blocked'
  | 'session.completed'
  | 'session.failed'
  | 'session.stopped'
  | 'session.warning'
  | 'workspace.created'
  | 'branch.created'
  | 'codex.runner_started'
  | 'codex.runner_completed'
  | 'codex.runner_failed'
  | 'codex.thread_started'
  | 'codex.container_setup'
  | 'codex.delivery_completed'
  | 'codex.delivery_failed'
  | 'artifact.created'
  | 'verification.passed'
  | 'verification.failed'
  | 'branch.pushed'
  | 'pull_request.created'
  | 'workspace.destroyed'
  | 'workspace.preserved'
  | 'workspace.heartbeat';

export function createEvent(
  sessionId: string,
  type: EventType,
  message: string,
  extra?: { state?: string; metadata?: Record<string, unknown> },
): HydrazEvent {
  return {
    timestamp: new Date().toISOString(),
    sessionId,
    type,
    message: redactSecrets(message),
    state: extra?.state,
    metadata: redactMetadata(extra?.metadata),
  };
}

export function appendEvent(repoRoot: string, event: HydrazEvent): void {
  const eventsFile = join(getSessionDir(repoRoot, event.sessionId), 'events.jsonl');
  appendFileSync(eventsFile, JSON.stringify(event) + '\n', { mode: 0o600 });
}

export function readEvents(repoRoot: string, sessionId: string): HydrazEvent[] {
  const eventsFile = join(getSessionDir(repoRoot, sessionId), 'events.jsonl');

  if (!existsSync(eventsFile)) {
    return [];
  }

  const content = readFileSync(eventsFile, 'utf-8').trim();
  if (content.length === 0) {
    return [];
  }

  const events: HydrazEvent[] = [];
  for (const line of content.split('\n')) {
    try {
      events.push(JSON.parse(line) as HydrazEvent);
    } catch {
      // skip corrupt lines
    }
  }
  return events;
}

export function formatEvent(event: HydrazEvent): string {
  const time = sanitizeInlineTerminalText(event.timestamp.replace('T', ' ').replace(/\.\d+Z$/, 'Z'));
  const type = sanitizeInlineTerminalText(event.type);
  const state = event.state ? ` [${sanitizeInlineTerminalText(event.state)}]` : '';
  const message = sanitizeInlineTerminalText(redactSecrets(event.message));
  return `${time}  ${type}${state}  ${message}`;
}

function redactMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!metadata) return undefined;
  return redactMetadataValue(metadata) as Record<string, unknown>;
}

function redactMetadataValue(value: unknown): unknown {
  if (typeof value === 'string') return redactSecrets(value);
  if (Array.isArray(value)) return value.map(redactMetadataValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        redactMetadataValue(entry),
      ]),
    );
  }
  return value;
}
