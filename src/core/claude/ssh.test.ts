import { describe, it, expect } from 'vitest';
import { shellEscape, buildSshClaudeArgs } from './ssh.js';

describe('shellEscape', () => {
  it('wraps simple strings in single quotes', () => {
    expect(shellEscape('hello')).toBe("'hello'");
  });

  it('escapes embedded single quotes', () => {
    expect(shellEscape("can't")).toBe("'can'\\''t'");
  });

  it('handles strings with dollar signs', () => {
    const escaped = shellEscape('$HOME');
    expect(escaped).toBe("'$HOME'");
  });

  it('handles strings with double quotes', () => {
    const escaped = shellEscape('say "hello"');
    expect(escaped).toBe("'say \"hello\"'");
  });

  it('handles strings with newlines', () => {
    const escaped = shellEscape('line1\nline2');
    expect(escaped).toBe("'line1\nline2'");
  });

  it('handles empty strings', () => {
    expect(shellEscape('')).toBe("''");
  });

  it('handles strings with backslashes', () => {
    expect(shellEscape('path\\to\\file')).toBe("'path\\to\\file'");
  });
});

describe('buildSshClaudeArgs', () => {
  it('returns ssh as the command', () => {
    const result = buildSshClaudeArgs('my-workspace', ['--print', 'do stuff']);
    expect(result.cmd).toBe('ssh');
  });

  it('targets the devpod workspace SSH alias', () => {
    const result = buildSshClaudeArgs('my-workspace', ['--print', 'do stuff']);
    expect(result.args[0]).toBe('my-workspace.devpod');
  });

  it('builds a single shell command string with claude and escaped args', () => {
    const result = buildSshClaudeArgs('ws', ['--print', '--output-format', 'stream-json', 'fix the bug']);
    const commandString = result.args[1];
    expect(commandString).toContain('claude');
    expect(commandString).toContain('--print');
    expect(commandString).toContain('stream-json');
    expect(commandString).toContain("'fix the bug'");
  });

  it('escapes special characters in prompt text', () => {
    const result = buildSshClaudeArgs('ws', ['--print', "it's $HOME \"quoted\""]);
    const commandString = result.args[1];
    // $HOME appears inside single quotes, so the remote shell won't expand it
    expect(commandString).toContain("$HOME");
    // Single quote in "it's" is properly escaped
    expect(commandString).toContain("'\\''");
  });

  it('does not escape flag arguments that are safe', () => {
    const result = buildSshClaudeArgs('ws', ['--print', '--verbose']);
    const commandString = result.args[1];
    expect(commandString).toContain("'--print'");
    expect(commandString).toContain("'--verbose'");
  });

  it('prepends env vars to the remote command when provided', () => {
    const env = { CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-test' };
    const result = buildSshClaudeArgs('ws', ['--print', 'do stuff'], env);
    const commandString = result.args[1];
    expect(commandString).toMatch(/^CLAUDE_CODE_OAUTH_TOKEN=/);
    expect(commandString).toContain('claude');
  });

  it('escapes env var values with single quotes', () => {
    const env = { TOKEN: "it's a token" };
    const result = buildSshClaudeArgs('ws', ['--print'], env);
    const commandString = result.args[1];
    expect(commandString).toContain("TOKEN='it'\\''s a token'");
  });

  it('handles multiple env vars', () => {
    const env = { VAR1: 'val1', VAR2: 'val2' };
    const result = buildSshClaudeArgs('ws', ['--print'], env);
    const commandString = result.args[1];
    expect(commandString).toContain("VAR1='val1'");
    expect(commandString).toContain("VAR2='val2'");
  });

  it('omits env var prefix when env is empty or undefined', () => {
    const result = buildSshClaudeArgs('ws', ['--print']);
    const commandString = result.args[1];
    expect(commandString).toMatch(/^claude /);
  });
});
