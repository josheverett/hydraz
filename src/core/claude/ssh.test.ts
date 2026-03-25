import { describe, it, expect } from 'vitest';
import { shellEscape, buildSshClaudeArgs, buildAuthLoadPrefix } from './ssh.js';

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

  it('prepends auth load prefix when authFilePath is provided', () => {
    const result = buildSshClaudeArgs('ws', ['--print', 'do stuff'], '/workspaces/ws/.hydraz-auth');
    const commandString = result.args[1];
    expect(commandString).toContain('set -a');
    expect(commandString).toContain('.hydraz-auth');
    expect(commandString).toContain('claude');
  });

  it('does not include auth prefix when authFilePath is undefined', () => {
    const result = buildSshClaudeArgs('ws', ['--print']);
    const commandString = result.args[1];
    expect(commandString).toMatch(/^claude /);
  });

  it('prepends cd to working directory when provided', () => {
    const result = buildSshClaudeArgs('ws', ['--print'], undefined, '/workspaces/ws/worktrees/s1');
    const commandString = result.args[1];
    expect(commandString).toMatch(/^cd '\/workspaces\/ws\/worktrees\/s1' && claude/);
  });

  it('combines cd, auth, and claude in the correct order', () => {
    const result = buildSshClaudeArgs('ws', ['--print'], '/ws/.hydraz-auth', '/ws/worktrees/s1');
    const commandString = result.args[1];
    const cdIdx = commandString.indexOf('cd ');
    const authIdx = commandString.indexOf('set -a');
    const claudeIdx = commandString.indexOf('claude');
    expect(cdIdx).toBeLessThan(authIdx);
    expect(authIdx).toBeLessThan(claudeIdx);
  });

  it('deletes auth file after reading in the remote command', () => {
    const result = buildSshClaudeArgs('ws', ['--print'], '/workspaces/ws/.hydraz-auth');
    const commandString = result.args[1];
    expect(commandString).toContain('rm -f');
    expect(commandString).toContain('.hydraz-auth');
  });
});

describe('buildAuthLoadPrefix', () => {
  it('sources the auth file with auto-export enabled', () => {
    const prefix = buildAuthLoadPrefix('/path/.hydraz-auth');
    expect(prefix).toContain('set -a');
    expect(prefix).toContain('/path/.hydraz-auth');
  });

  it('removes the auth file after reading', () => {
    const prefix = buildAuthLoadPrefix('/path/.hydraz-auth');
    expect(prefix).toContain('rm -f');
  });

  it('uses the correct file path', () => {
    const prefix = buildAuthLoadPrefix('/workspaces/myrepo/.hydraz-auth');
    expect(prefix).toContain('/workspaces/myrepo/.hydraz-auth');
  });
});
