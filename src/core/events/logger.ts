import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
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
  | 'workspace.created'
  | 'branch.created'
  | 'claude.ready'
  | 'claude.auth_resolved'
  | 'swarm.started'
  | 'swarm.phase_changed'
  | 'artifact.created'
  | 'verification.passed'
  | 'verification.failed';

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
  appendFileSync(eventsFile, JSON.stringify(event) + '\n');
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

  return content
    .split('\n')
    .map((line) => JSON.parse(line) as HydrazEvent);
}

export function formatEvent(event: HydrazEvent): string {
  const time = event.timestamp.replace('T', ' ').replace(/\.\d+Z$/, 'Z');
  const state = event.state ? ` [${event.state}]` : '';
  return `${time}  ${event.type}${state}  ${event.message}`;
}
