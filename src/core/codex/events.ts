export interface CodexUsage {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  reasoningOutputTokens?: number;
}

export type ParsedCodexEvent =
  | { type: 'thread.started'; threadId: string; raw: unknown }
  | { type: 'turn.completed'; usage?: CodexUsage; raw: unknown }
  | { type: 'turn.failed'; message: string; raw: unknown }
  | { type: 'error'; message: string; raw: unknown }
  | { type: 'unknown'; raw: unknown };

export function parseCodexJsonLine(line: string): ParsedCodexEvent | null {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }

  if (typeof raw !== 'object' || raw === null) {
    return { type: 'unknown', raw };
  }

  const event = raw as Record<string, unknown>;
  const type = typeof event.type === 'string' ? event.type : '';

  if (type === 'thread.started' && typeof event.thread_id === 'string') {
    return { type: 'thread.started', threadId: event.thread_id, raw };
  }

  if (type === 'turn.completed') {
    const usage = typeof event.usage === 'object' && event.usage !== null
      ? event.usage as Record<string, unknown>
      : undefined;
    return {
      type: 'turn.completed',
      usage: usage
        ? {
            inputTokens: numberValue(usage.input_tokens),
            cachedInputTokens: numberValue(usage.cached_input_tokens),
            outputTokens: numberValue(usage.output_tokens),
            reasoningOutputTokens: numberValue(usage.reasoning_output_tokens),
          }
        : undefined,
      raw,
    };
  }

  if (type === 'turn.failed') {
    return { type: 'turn.failed', message: messageFrom(event), raw };
  }

  if (type === 'error') {
    return { type: 'error', message: messageFrom(event), raw };
  }

  return { type: 'unknown', raw };
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function messageFrom(event: Record<string, unknown>): string {
  if (typeof event.message === 'string') return event.message;
  if (typeof event.error === 'string') return event.error;
  return 'Codex event did not include an error message';
}
