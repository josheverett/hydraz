import { describe, expect, it } from 'vitest';
import { parseCodexJsonLine } from './events.js';

describe('parseCodexJsonLine', () => {
  it('captures thread ids from thread.started events', () => {
    const parsed = parseCodexJsonLine(
      JSON.stringify({ type: 'thread.started', thread_id: 'thread-123' }),
    );

    expect(parsed).toEqual({
      type: 'thread.started',
      threadId: 'thread-123',
      raw: { type: 'thread.started', thread_id: 'thread-123' },
    });
  });

  it('captures usage from completed turns', () => {
    const parsed = parseCodexJsonLine(JSON.stringify({
      type: 'turn.completed',
      usage: {
        input_tokens: 10,
        cached_input_tokens: 3,
        output_tokens: 5,
        reasoning_output_tokens: 2,
      },
    }));

    expect(parsed).toMatchObject({
      type: 'turn.completed',
      usage: {
        inputTokens: 10,
        cachedInputTokens: 3,
        outputTokens: 5,
        reasoningOutputTokens: 2,
      },
    });
  });

  it('returns null for non-json lines', () => {
    expect(parseCodexJsonLine('not json')).toBeNull();
  });
});
