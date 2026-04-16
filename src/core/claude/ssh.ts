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

const VALID_ENV_KEY = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function buildExportStatements(env: Record<string, string>): string[] {
  return Object.entries(env).map(([key, value]) => {
    if (!VALID_ENV_KEY.test(key)) {
      throw new Error(`Invalid environment variable name: ${key}`);
    }
    return `export ${key}=${shellEscape(value)}`;
  });
}

export function buildSshNodeCommand(
  workspaceName: string,
  scriptPath: string,
  scriptArgs: string[],
  authEnv?: Record<string, string>,
  workingDirectory?: string,
  stdinData?: string,
): SshCommand {
  const scriptLines = ['set -eu'];

  if (workingDirectory) {
    scriptLines.push(`cd ${shellEscape(workingDirectory)}`);
  }

  if (authEnv && Object.keys(authEnv).length > 0) {
    scriptLines.push(...buildExportStatements(authEnv));
  }

  if (stdinData) {
    scriptLines.push(`export HYDRAZ_PIPELINE_OPTIONS=${shellEscape(stdinData)}`);
  }

  const escapedArgs = scriptArgs.map(shellEscape);
  scriptLines.push(`exec node ${shellEscape(scriptPath)} ${escapedArgs.join(' ')}`);

  return {
    cmd: 'ssh',
    args: [`${workspaceName}.devpod`, 'sh', '-s'],
    stdinScript: scriptLines.join('\n') + '\n',
  };
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
