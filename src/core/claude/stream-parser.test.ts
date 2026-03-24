import { describe, it, expect } from 'vitest';
import { parseStreamLine, type ParsedClaudeEvent } from './stream-parser.js';

describe('parseStreamLine', () => {
  it('returns null for empty lines', () => {
    expect(parseStreamLine('')).toBeNull();
    expect(parseStreamLine('  ')).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(parseStreamLine('NOT_JSON')).toBeNull();
  });

  it('parses system init event', () => {
    const line = JSON.stringify({
      type: 'system',
      subtype: 'init',
      session_id: 'sess_1',
      model: 'sonnet',
      tools: ['Bash', 'Read', 'Write'],
    });
    const event = parseStreamLine(line)!;
    expect(event.kind).toBe('init');
    expect(event.model).toBe('sonnet');
    expect(event.tools).toEqual(['Bash', 'Read', 'Write']);
  });

  it('parses assistant text event', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: 'Planning next steps.' }],
      },
    });
    const event = parseStreamLine(line)!;
    expect(event.kind).toBe('text');
    expect(event.text).toBe('Planning next steps.');
  });

  it('parses assistant tool_use event', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        content: [{
          type: 'tool_use',
          id: 'toolu_1',
          name: 'Bash',
          input: { command: 'ls -la' },
        }],
      },
    });
    const event = parseStreamLine(line)!;
    expect(event.kind).toBe('tool_call');
    expect(event.toolName).toBe('Bash');
    expect(event.toolInput).toBe('ls -la');
  });

  it('parses tool_use for Read with file_path', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        content: [{
          type: 'tool_use',
          name: 'Read',
          input: { file_path: 'src/index.ts' },
        }],
      },
    });
    const event = parseStreamLine(line)!;
    expect(event.kind).toBe('tool_call');
    expect(event.toolName).toBe('Read');
    expect(event.toolInput).toBe('src/index.ts');
  });

  it('parses user tool_result with string content', () => {
    const line = JSON.stringify({
      type: 'user',
      message: {
        content: [{
          type: 'tool_result',
          tool_use_id: 'toolu_1',
          content: 'total 5\nREADME.md\nsrc/',
        }],
      },
    });
    const event = parseStreamLine(line)!;
    expect(event.kind).toBe('tool_result');
    expect(event.toolResult).toContain('README.md');
  });

  it('parses user tool_result with array content', () => {
    const line = JSON.stringify({
      type: 'user',
      message: {
        content: [{
          type: 'tool_result',
          tool_use_id: 'toolu_2',
          content: [{ type: 'text', text: 'Task completed' }],
        }],
      },
    });
    const event = parseStreamLine(line)!;
    expect(event.kind).toBe('tool_result');
    expect(event.toolResult).toBe('Task completed');
  });

  it('parses result success event', () => {
    const line = JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'Done.',
      total_cost_usd: 0.0123,
      duration_ms: 12345,
      num_turns: 5,
      usage: { input_tokens: 150, output_tokens: 70 },
    });
    const event = parseStreamLine(line)!;
    expect(event.kind).toBe('complete');
    expect(event.cost).toBe(0.0123);
    expect(event.durationMs).toBe(12345);
    expect(event.turns).toBe(5);
    expect(event.inputTokens).toBe(150);
    expect(event.outputTokens).toBe(70);
  });

  it('parses result error event', () => {
    const line = JSON.stringify({
      type: 'result',
      subtype: 'error',
      is_error: true,
      error: 'Permission denied',
      total_cost_usd: 0.001,
    });
    const event = parseStreamLine(line)!;
    expect(event.kind).toBe('error');
    expect(event.error).toBe('Permission denied');
    expect(event.cost).toBe(0.001);
  });

  it('returns unknown for unrecognized event types', () => {
    const line = JSON.stringify({ type: 'something_new', data: 'hi' });
    const event = parseStreamLine(line)!;
    expect(event.kind).toBe('unknown');
  });

  it('includes timestamp on all events', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'hi' }] },
    });
    const event = parseStreamLine(line)!;
    expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('preserves raw event data', () => {
    const raw = { type: 'system' as const, subtype: 'init', model: 'opus' };
    const line = JSON.stringify(raw);
    const event = parseStreamLine(line)!;
    expect(event.raw.model).toBe('opus');
  });
});
