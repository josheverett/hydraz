import { describe, it, expect } from 'vitest';
import { BASH_COMMAND_EVENT_MAX_LEN, persistToolInputForEvent } from './tool-input-persist.js';

describe('persistToolInputForEvent', () => {
  it('truncates long Bash tool input and appends an ellipsis', () => {
    const long = 'x'.repeat(BASH_COMMAND_EVENT_MAX_LEN + 50);
    const out = persistToolInputForEvent('Bash', long);
    expect(out).toHaveLength(BASH_COMMAND_EVENT_MAX_LEN + 1);
    expect(out.endsWith('…')).toBe(true);
    expect(out.slice(0, BASH_COMMAND_EVENT_MAX_LEN)).toBe('x'.repeat(BASH_COMMAND_EVENT_MAX_LEN));
  });

  it('does not truncate Bash input at or below the limit', () => {
    const s = 'echo hello';
    expect(persistToolInputForEvent('Bash', s)).toBe(s);
    const exact = 'y'.repeat(BASH_COMMAND_EVENT_MAX_LEN);
    expect(persistToolInputForEvent('Bash', exact)).toBe(exact);
  });

  it('does not truncate non-Bash tool input', () => {
    const long = 'z'.repeat(500);
    expect(persistToolInputForEvent('Read', long)).toBe(long);
  });

  it('returns empty string for missing input', () => {
    expect(persistToolInputForEvent('Bash', undefined)).toBe('');
    expect(persistToolInputForEvent('Bash', '')).toBe('');
  });
});
