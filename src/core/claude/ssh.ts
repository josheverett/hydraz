/**
 * POSIX shell escaping: wrap in single quotes, escape embedded single quotes.
 * This prevents the remote shell from interpreting special characters
 * ($, ", \, newlines, etc.) when passing arguments through SSH.
 */
export function shellEscape(arg: string): string {
  return "'" + arg.replace(/'/g, "'\\''") + "'";
}

export function buildAuthLoadPrefix(authFilePath: string): string {
  const escaped = shellEscape(authFilePath);
  return `set -a && . ${escaped} && set +a && rm -f ${escaped} && `;
}

export function buildSshClaudeArgs(
  workspaceName: string,
  claudeArgs: string[],
  authFilePath?: string,
): { cmd: string; args: string[] } {
  const escapedArgs = claudeArgs.map(shellEscape);
  const claudeCommand = `claude ${escapedArgs.join(' ')}`;

  const remoteCommand = authFilePath
    ? `${buildAuthLoadPrefix(authFilePath)}${claudeCommand}`
    : claudeCommand;

  return {
    cmd: 'ssh',
    args: [`${workspaceName}.devpod`, remoteCommand],
  };
}
