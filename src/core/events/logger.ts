import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sanitizeInlineTerminalText } from '../display/sanitize.js';
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
  | 'claude.ready'
  | 'claude.auth_resolved'
  | 'swarm.started'
  | 'swarm.container_setup'
  | 'swarm.phase_changed'
  | 'swarm.investigate_started'
  | 'swarm.investigate_completed'
  | 'swarm.architect_started'
  | 'swarm.architect_completed'
  | 'swarm.plan_started'
  | 'swarm.plan_completed'
  | 'swarm.consensus_round'
  | 'swarm.worker_launched'
  | 'swarm.worker_completed'
  | 'swarm.worker_failed'
  | 'swarm.merge_started'
  | 'swarm.merge_completed'
  | 'swarm.merge_conflict'
  | 'swarm.review_started'
  | 'swarm.review_completed'
  | 'swarm.review_feedback'
  | 'swarm.outer_loop'
  | 'swarm.delivery_started'
  | 'swarm.delivery_completed'
  | 'artifact.created'
  | 'verification.passed'
  | 'verification.failed'
  | 'branch.pushed'
  | 'pull_request.created'
  | 'workspace.destroyed'
  | 'workspace.preserved'
  | 'workspace.heartbeat'
  | 'swarm.heartbeat';

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
    message,
    state: extra?.state,
    metadata: extra?.metadata,
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
  const message = sanitizeInlineTerminalText(event.message);
  return `${time}  ${type}${state}  ${message}`;
}
