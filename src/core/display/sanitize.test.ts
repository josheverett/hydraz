import { describe, expect, it } from 'vitest';
import {
  sanitizeInlineTerminalText,
  sanitizeMultilineTerminalText,
} from './sanitize.js';

describe('terminal text sanitizers', () => {
  it('preserves existing inline sanitization behavior', () => {
    expect(sanitizeInlineTerminalText('hello\t\u001b[31mred\u001b[0m\r\nworld')).toBe('hello red world');
  });

  it('preserves existing multiline sanitization behavior', () => {
    expect(sanitizeMultilineTerminalText('hello\t\u001b[31mred\u001b[0m\nworld')).toBe('hello red\nworld');
  });
});

describe('redactSecrets', () => {
  it('redacts GitHub token prefixes', () => {
    expect(sanitizeInlineTerminalText('github_pat_abc123')).toBe('[REDACTED]');
    expect(sanitizeInlineTerminalText('ghp_abc123')).toBe('[REDACTED]');
    expect(sanitizeInlineTerminalText('gho_abc123')).toBe('[REDACTED]');
    expect(sanitizeInlineTerminalText('ghu_abc123')).toBe('[REDACTED]');
    expect(sanitizeInlineTerminalText('ghs_abc123')).toBe('[REDACTED]');
    expect(sanitizeInlineTerminalText('ghr_abc123')).toBe('[REDACTED]');
  });

  it('redacts OpenAI style API keys in env assignments', () => {
    expect(sanitizeInlineTerminalText('OPENAI_API_KEY=sk-test123')).toBe('OPENAI_API_KEY=[REDACTED]');
    expect(sanitizeInlineTerminalText('OPENAI_API_KEY=sk-proj-test123')).toBe('OPENAI_API_KEY=[REDACTED]');
  });

  it('redacts authorization header values', () => {
    expect(sanitizeInlineTerminalText('Authorization: Bearer github_pat_abc123')).toBe('Authorization: Bearer [REDACTED]');
    expect(sanitizeInlineTerminalText('AUTHORIZATION: basic abc123')).toBe('AUTHORIZATION: basic [REDACTED]');
  });

  it('redacts JSON token-like fields', () => {
    expect(sanitizeInlineTerminalText('{"token":"github_pat_abc123"}')).toBe('{"token":"[REDACTED]"}');
    expect(sanitizeInlineTerminalText('{"apiKey":"sk-test123"}')).toBe('{"apiKey":"[REDACTED]"}');
    expect(sanitizeInlineTerminalText('{"extraheader":"AUTHORIZATION: basic abc123"}')).toBe('{"extraheader":"[REDACTED]"}');
  });

  it('redacts quoted env assignments', () => {
    expect(sanitizeInlineTerminalText("GH_TOKEN='github_pat_abc123'")).toBe("GH_TOKEN='[REDACTED]'");
    expect(sanitizeInlineTerminalText('PASSWORD="supersecret"')).toBe('PASSWORD="[REDACTED]"');
  });

  it('does not redact ordinary branch names, URLs, or non-secret words', () => {
    const text = 'branch hydraz/add-feature url https://github.com/octocat/hello-world tokenized text';
    expect(sanitizeInlineTerminalText(text)).toBe(text);
  });
});
