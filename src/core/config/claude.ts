import { execSync } from 'node:child_process';

export interface ClaudeCheckResult {
  available: boolean;
  version?: string;
  error?: string;
}

export function parseClaudeVersion(output: string): string | null {
  const trimmed = output.trim();
  const match = trimmed.match(/(\d+\.\d+\.\d+)/);
  return match ? match[1] : null;
}

export function checkClaudeAvailability(): ClaudeCheckResult {
  try {
    const output = execSync('claude --version', {
      encoding: 'utf-8',
      timeout: 10_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const version = parseClaudeVersion(output);
    return { available: true, version: version ?? undefined };
  } catch {
    return {
      available: false,
      error: 'Claude Code CLI not found. Ensure "claude" is installed and on your PATH.',
    };
  }
}
