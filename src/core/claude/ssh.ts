/**
 * POSIX shell escaping: wrap in single quotes, escape embedded single quotes.
 * This prevents the remote shell from interpreting special characters
 * ($, ", \, newlines, etc.) when passing arguments through SSH.
 */
export function shellEscape(arg: string): string {
  return "'" + arg.replace(/'/g, "'\\''") + "'";
}

export interface SshCommand {
  cmd: string;
  args: string[];
  stdinScript?: string;
}

function buildExportStatements(env: Record<string, string>): string[] {
  return Object.entries(env).map(([key, value]) => `export ${key}=${shellEscape(value)}`);
}

export function buildSshClaudeArgs(
  workspaceName: string,
  claudeArgs: string[],
  authEnv?: Record<string, string>,
  workingDirectory?: string,
): SshCommand {
  const escapedArgs = claudeArgs.map(shellEscape);
  const scriptLines = ['set -eu'];

  if (workingDirectory) {
    scriptLines.push(`cd ${shellEscape(workingDirectory)}`);
  }

  if (authEnv && Object.keys(authEnv).length > 0) {
    scriptLines.push(...buildExportStatements(authEnv));
  }

  scriptLines.push(`exec claude ${escapedArgs.join(' ')}`);

  return {
    cmd: 'ssh',
    args: [`${workspaceName}.devpod`, 'sh', '-s'],
    stdinScript: scriptLines.join('\n') + '\n',
  };
}
