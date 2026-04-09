import { describe, it, expect } from 'vitest';
import { shellEscape, buildSshClaudeArgs, buildSshNodeCommand } from './ssh.js';

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

  it('launches a remote shell that reads the script from stdin', () => {
    const result = buildSshClaudeArgs('ws', ['--print']);
    expect(result.args).toEqual(['ws.devpod', 'sh', '-s']);
  });

  it('builds a shell script with claude and escaped args', () => {
    const result = buildSshClaudeArgs('ws', ['--print', '--output-format', 'stream-json', 'fix the bug']);
    const script = result.stdinScript ?? '';
    expect(script).toContain('exec claude');
    expect(script).toContain("'--print'");
    expect(script).toContain("'stream-json'");
    expect(script).toContain("'fix the bug'");
  });

  it('escapes special characters in prompt text', () => {
    const result = buildSshClaudeArgs('ws', ['--print', "it's $HOME \"quoted\""]);
    const script = result.stdinScript ?? '';
    // $HOME appears inside single quotes, so the remote shell won't expand it
    expect(script).toContain("$HOME");
    // Single quote in "it's" is properly escaped
    expect(script).toContain("'\\''");
  });

  it('does not escape flag arguments that are safe', () => {
    const result = buildSshClaudeArgs('ws', ['--print', '--verbose']);
    const script = result.stdinScript ?? '';
    expect(script).toContain("'--print'");
    expect(script).toContain("'--verbose'");
  });

  it('exports auth env values inline in the stdin script', () => {
    const result = buildSshClaudeArgs('ws', ['--print', 'do stuff'], {
      CLAUDE_CODE_OAUTH_TOKEN: 'secret-token',
    });
    const script = result.stdinScript ?? '';
    expect(script).toContain("export CLAUDE_CODE_OAUTH_TOKEN='secret-token'");
    expect(script).toContain('exec claude');
  });

  it('does not reference an auth temp file', () => {
    const result = buildSshClaudeArgs('ws', ['--print'], {
      CLAUDE_CODE_OAUTH_TOKEN: 'secret-token',
    });
    const script = result.stdinScript ?? '';
    expect(script).not.toContain('.hydraz-auth');
  });

  it('still builds a stdin script when no auth env is provided', () => {
    const result = buildSshClaudeArgs('ws', ['--print']);
    expect(result.stdinScript).toContain('exec claude');
  });

  it('prepends cd to working directory when provided', () => {
    const result = buildSshClaudeArgs('ws', ['--print'], undefined, '/workspaces/ws/worktrees/s1');
    const script = result.stdinScript ?? '';
    expect(script).toContain("cd '/workspaces/ws/worktrees/s1'");
  });

  it('rejects env var keys with shell metacharacters', () => {
    expect(() =>
      buildSshClaudeArgs('ws', ['--print'], { 'FOO$(whoami)': 'val' }),
    ).toThrow();
    expect(() =>
      buildSshClaudeArgs('ws', ['--print'], { 'NAME WITH SPACES': 'val' }),
    ).toThrow();
    expect(() =>
      buildSshClaudeArgs('ws', ['--print'], { '': 'val' }),
    ).toThrow();
  });

  it('combines cd, auth exports, and claude in the correct order', () => {
    const result = buildSshClaudeArgs(
      'ws',
      ['--print'],
      { CLAUDE_CODE_OAUTH_TOKEN: 'secret-token' },
      '/ws/worktrees/s1',
    );
    const script = result.stdinScript ?? '';
    const cdIdx = script.indexOf('cd ');
    const exportIdx = script.indexOf('export CLAUDE_CODE_OAUTH_TOKEN');
    const claudeIdx = script.indexOf('exec claude');
    expect(cdIdx).toBeLessThan(exportIdx);
    expect(exportIdx).toBeLessThan(claudeIdx);
  });
});

describe('buildSshNodeCommand', () => {
  it('returns ssh as the command', () => {
    const result = buildSshNodeCommand('my-ws', '/tmp/hydraz-dist/runner.js', ['{}']);
    expect(result.cmd).toBe('ssh');
  });

  it('targets the devpod workspace SSH alias', () => {
    const result = buildSshNodeCommand('my-ws', '/tmp/hydraz-dist/runner.js', ['{}']);
    expect(result.args[0]).toBe('my-ws.devpod');
  });

  it('launches a remote shell that reads the script from stdin', () => {
    const result = buildSshNodeCommand('ws', '/tmp/runner.js', []);
    expect(result.args).toEqual(['ws.devpod', 'sh', '-s']);
  });

  it('builds a shell script with exec node and the script path', () => {
    const result = buildSshNodeCommand('ws', '/tmp/hydraz-dist/core/swarm/pipeline-runner.js', []);
    const script = result.stdinScript ?? '';
    expect(script).toContain('exec node');
    expect(script).toContain("'/tmp/hydraz-dist/core/swarm/pipeline-runner.js'");
  });

  it('includes shell-escaped script arguments', () => {
    const result = buildSshNodeCommand('ws', '/tmp/runner.js', ['{"task":"fix it"}', '--verbose']);
    const script = result.stdinScript ?? '';
    expect(script).toContain("'{\"task\":\"fix it\"}'");
    expect(script).toContain("'--verbose'");
  });

  it('exports auth env when provided', () => {
    const result = buildSshNodeCommand('ws', '/tmp/runner.js', [], {
      CLAUDE_CODE_OAUTH_TOKEN: 'secret-token',
    });
    const script = result.stdinScript ?? '';
    expect(script).toContain("export CLAUDE_CODE_OAUTH_TOKEN='secret-token'");
  });

  it('prepends cd when workingDirectory is provided', () => {
    const result = buildSshNodeCommand('ws', '/tmp/runner.js', [], undefined, '/workspaces/ws');
    const script = result.stdinScript ?? '';
    expect(script).toContain("cd '/workspaces/ws'");
  });

  it('combines cd, auth exports, and node in the correct order', () => {
    const result = buildSshNodeCommand(
      'ws',
      '/tmp/runner.js',
      ['{}'],
      { CLAUDE_CODE_OAUTH_TOKEN: 'secret-token' },
      '/workspaces/ws',
    );
    const script = result.stdinScript ?? '';
    const cdIdx = script.indexOf('cd ');
    const exportIdx = script.indexOf('export CLAUDE_CODE_OAUTH_TOKEN');
    const nodeIdx = script.indexOf('exec node');
    expect(cdIdx).toBeLessThan(exportIdx);
    expect(exportIdx).toBeLessThan(nodeIdx);
  });
});
