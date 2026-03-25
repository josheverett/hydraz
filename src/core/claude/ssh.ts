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
  env?: Record<string, string>,
): { cmd: string; args: string[] } {
  const escapedArgs = claudeArgs.map(shellEscape);
  const claudeCommand = `claude ${escapedArgs.join(' ')}`;

  let remoteCommand: string;
  if (env && Object.keys(env).length > 0) {
    const envPrefix = Object.entries(env)
      .map(([key, value]) => `${key}=${shellEscape(value)}`)
      .join(' ');
    remoteCommand = `${envPrefix} ${claudeCommand}`;
  } else {
    remoteCommand = claudeCommand;
  }

  return {
    cmd: 'ssh',
    args: [`${workspaceName}.devpod`, remoteCommand],
  };
}
