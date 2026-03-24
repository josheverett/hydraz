import { checkClaudeAvailability, type ClaudeCheckResult } from '../config/claude.js';
import { loadConfig } from '../config/loader.js';
import { validateAuthAvailability, describeAuthMode } from '../providers/auth.js';

export interface AuthResolution {
  resolved: boolean;
  mode: string;
  modeDescription: string;
  claudeAvailable: boolean;
  claudeVersion?: string;
  errors: string[];
}

export function resolveAuth(configDir?: string): AuthResolution {
  const config = loadConfig(configDir);
  const errors: string[] = [];

  const claudeCheck: ClaudeCheckResult = checkClaudeAvailability();
  if (!claudeCheck.available) {
    errors.push(claudeCheck.error ?? 'Claude Code CLI is not available.');
  }

  const authCheck = validateAuthAvailability(config);
  if (!authCheck.valid) {
    errors.push(authCheck.error ?? 'Auth validation failed.');
  }

  return {
    resolved: errors.length === 0,
    mode: config.claudeAuth.mode,
    modeDescription: describeAuthMode(config),
    claudeAvailable: claudeCheck.available,
    claudeVersion: claudeCheck.version,
    errors,
  };
}

export function formatAuthResolution(auth: AuthResolution): string {
  const lines: string[] = [];
  lines.push(`  Auth mode:       ${auth.modeDescription}`);
  lines.push(`  Claude CLI:      ${auth.claudeAvailable ? `available${auth.claudeVersion ? ` (v${auth.claudeVersion})` : ''}` : 'NOT FOUND'}`);

  if (auth.errors.length > 0) {
    lines.push('  Issues:');
    for (const err of auth.errors) {
      lines.push(`    - ${err}`);
    }
  } else {
    lines.push('  Status:          ready');
  }

  return lines.join('\n');
}
