import type { ParsedClaudeEvent } from './stream-parser.js';
import type { DisplayVerbosity } from '../config/schema.js';

export function formatStreamEvent(
  event: ParsedClaudeEvent,
  verbosity: DisplayVerbosity = 'compact',
): string | null {
  const ts = formatTimestamp(event.timestamp);

  switch (event.kind) {
    case 'init':
      return `${ts}  claude.init      ${event.model ?? 'unknown model'}${event.tools ? ` (${event.tools.length} tools)` : ''}`;

    case 'text': {
      if (verbosity === 'compact') {
        const preview = truncate(singleLine(event.text ?? ''), 80);
        return `${ts}  claude.text      ${preview}`;
      }
      return `${ts}  claude.text      ${event.text}`;
    }

    case 'tool_call':
      return `${ts}  claude.tool      ${event.toolName}: ${event.toolInput ?? ''}`;

    case 'tool_result': {
      if (verbosity === 'compact') return null;
      const preview = truncate(singleLine(event.toolResult ?? ''), 100);
      return `${ts}  claude.result    → ${preview}`;
    }

    case 'complete': {
      const parts = ['Session complete'];
      if (event.cost != null) parts.push(`$${event.cost.toFixed(4)}`);
      if (event.inputTokens != null && event.outputTokens != null) {
        parts.push(`${event.inputTokens} in / ${event.outputTokens} out`);
      }
      if (event.durationMs != null) parts.push(formatDuration(event.durationMs));
      if (event.turns != null) parts.push(`${event.turns} turns`);
      return `${ts}  claude.complete  ${parts.join(' · ')}`;
    }

    case 'error':
      return `${ts}  claude.error     ${event.error ?? 'Unknown error'}`;

    case 'unknown':
      return null;
  }
}

function formatTimestamp(iso: string): string {
  return iso.replace(/\.\d{3}Z$/, 'Z');
}

function singleLine(text: string): string {
  return text.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + '...';
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes}m${remaining}s`;
}
