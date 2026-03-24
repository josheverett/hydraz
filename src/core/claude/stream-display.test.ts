import { describe, it, expect } from 'vitest';
import { formatStreamEvent, type DisplayVerbosity } from './stream-display.js';
import type { ParsedClaudeEvent } from './stream-parser.js';

function makeEvent(overrides: Partial<ParsedClaudeEvent>): ParsedClaudeEvent {
  return {
    kind: 'text',
    timestamp: '2026-03-23T16:45:05.123Z',
    raw: { type: 'assistant' },
    ...overrides,
  };
}

describe('formatStreamEvent', () => {
  it('formats init events with model and tool count', () => {
    const event = makeEvent({
      kind: 'init',
      model: 'sonnet',
      tools: ['Bash', 'Read', 'Write'],
    });
    const output = formatStreamEvent(event)!;
    expect(output).toContain('2026-03-23T16:45:05Z');
    expect(output).toContain('claude.init');
    expect(output).toContain('sonnet');
    expect(output).toContain('3 tools');
  });

  it('formats text events with truncation in compact mode', () => {
    const longText = 'I will now carefully analyze the entire codebase structure to understand the architecture before making any changes to ensure nothing breaks in the process of this modification.';
    const event = makeEvent({ kind: 'text', text: longText });
    const output = formatStreamEvent(event, 'compact')!;
    expect(output).toContain('claude.text');
    expect(output.length).toBeLessThan(200);
    expect(output).toContain('...');
  });

  it('formats text events without truncation in full mode', () => {
    const longText = 'A'.repeat(200);
    const event = makeEvent({ kind: 'text', text: longText });
    const output = formatStreamEvent(event, 'full')!;
    expect(output).toContain('A'.repeat(200));
  });

  it('formats tool calls with name and input', () => {
    const event = makeEvent({
      kind: 'tool_call',
      toolName: 'Bash',
      toolInput: 'npm test',
    });
    const output = formatStreamEvent(event)!;
    expect(output).toContain('claude.tool');
    expect(output).toContain('Bash: npm test');
  });

  it('hides tool results in compact mode', () => {
    const event = makeEvent({
      kind: 'tool_result',
      toolResult: 'some output',
    });
    const output = formatStreamEvent(event, 'compact');
    expect(output).toBeNull();
  });

  it('shows tool results in tool-results mode', () => {
    const event = makeEvent({
      kind: 'tool_result',
      toolResult: 'total 5\nREADME.md\nsrc/',
    });
    const output = formatStreamEvent(event, 'tool-results')!;
    expect(output).toContain('claude.result');
    expect(output).toContain('→');
    expect(output).toContain('README.md');
  });

  it('formats complete events with cost and tokens', () => {
    const event = makeEvent({
      kind: 'complete',
      cost: 0.0123,
      inputTokens: 150,
      outputTokens: 70,
      durationMs: 12345,
      turns: 5,
    });
    const output = formatStreamEvent(event)!;
    expect(output).toContain('claude.complete');
    expect(output).toContain('$0.0123');
    expect(output).toContain('150 in / 70 out');
    expect(output).toContain('12s');
    expect(output).toContain('5 turns');
  });

  it('formats error events', () => {
    const event = makeEvent({
      kind: 'error',
      error: 'Permission denied',
    });
    const output = formatStreamEvent(event)!;
    expect(output).toContain('claude.error');
    expect(output).toContain('Permission denied');
  });

  it('returns null for unknown events', () => {
    const event = makeEvent({ kind: 'unknown' });
    expect(formatStreamEvent(event)).toBeNull();
  });

  it('strips milliseconds from timestamps', () => {
    const event = makeEvent({ timestamp: '2026-03-23T16:45:05.123Z' });
    const output = formatStreamEvent(event)!;
    expect(output).toContain('2026-03-23T16:45:05Z');
    expect(output).not.toContain('.123');
  });

  it('formats duration in minutes for long runs', () => {
    const event = makeEvent({
      kind: 'complete',
      durationMs: 185_000,
    });
    const output = formatStreamEvent(event)!;
    expect(output).toContain('3m5s');
  });

  it('collapses multiline text to single line in compact mode', () => {
    const event = makeEvent({
      kind: 'text',
      text: 'Line one.\nLine two.\nLine three.',
    });
    const output = formatStreamEvent(event, 'compact')!;
    expect(output).not.toContain('\n');
  });
});
