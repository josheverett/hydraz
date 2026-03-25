/**
 * POSIX shell escaping: wrap in single quotes, escape embedded single quotes.
 * This prevents the remote shell from interpreting special characters
 * ($, ", \, newlines, etc.) when passing arguments through SSH.
 */
export function shellEscape(arg: string): string {
  return "'" + arg.replace(/'/g, "'\\''") + "'";
}

export function buildSshClaudeArgs(
  workspaceName: string,
  claudeArgs: string[],
): { cmd: string; args: string[] } {
  const escapedArgs = claudeArgs.map(shellEscape);
  const remoteCommand = `claude ${escapedArgs.join(' ')}`;

  return {
    cmd: 'ssh',
    args: [`${workspaceName}.devpod`, remoteCommand],
  };
}
