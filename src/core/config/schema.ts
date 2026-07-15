export type ExecutionTarget = 'local' | 'local-container' | 'cloud';
export type DisplayVerbosity = 'compact' | 'tool-results' | 'full';
export const CODEX_REASONING_EFFORTS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra',
] as const;
export type CodexReasoningEffort = (typeof CODEX_REASONING_EFFORTS)[number];
export const CODEX_SPEEDS = ['standard', 'fast'] as const;
export type CodexSpeed = (typeof CODEX_SPEEDS)[number];

export const DEFAULT_CODEX_MODEL = 'gpt-5.6-sol';
export const DEFAULT_CODEX_REASONING_EFFORT: CodexReasoningEffort = 'ultra';
export const DEFAULT_CODEX_SPEED: CodexSpeed = 'fast';

export interface BranchNamingConfig {
  prefix: string;
}

export interface GitHubAuthConfig {
  token?: string;
}

export interface RetentionConfig {
  keepTranscripts: boolean;
  keepTestLogs: boolean;
}

export interface CodexConfig {
  command: string;
  model?: string;
  reasoningEffort: CodexReasoningEffort;
  speed: CodexSpeed;
  sandbox: 'read-only' | 'workspace-write' | 'danger-full-access';
  search: boolean;
}

export interface HydrazConfig {
  executionTarget: ExecutionTarget;
  branchNaming: BranchNamingConfig;
  github: GitHubAuthConfig;
  codex: CodexConfig;
  retention: RetentionConfig;
  displayVerbosity: DisplayVerbosity;
}

export function createDefaultConfig(): HydrazConfig {
  return {
    executionTarget: 'cloud',
    branchNaming: {
      prefix: 'hydraz/',
    },
    github: {},
    codex: {
      command: 'codex',
      model: DEFAULT_CODEX_MODEL,
      reasoningEffort: DEFAULT_CODEX_REASONING_EFFORT,
      speed: DEFAULT_CODEX_SPEED,
      sandbox: 'workspace-write',
      search: false,
    },
    retention: {
      keepTranscripts: false,
      keepTestLogs: false,
    },
    displayVerbosity: 'compact',
  };
}

export function validateConfig(data: unknown): HydrazConfig {
  if (typeof data !== 'object' || data === null) {
    throw new ConfigValidationError('Config must be a non-null object');
  }

  const obj = data as Record<string, unknown>;
  const defaults = createDefaultConfig();


  const executionTarget = expectEnum(
    obj,
    'executionTarget',
    ['local', 'local-container', 'cloud'] as const,
    defaults.executionTarget,
  );
  const branchNaming = expectObject(obj, 'branchNaming', defaults.branchNaming, (val) => ({
    prefix: expectString(val as Record<string, unknown>, 'prefix', defaults.branchNaming.prefix),
  }));

  const github = expectObject(obj, 'github', defaults.github, (val) => ({
    token: expectOptionalString(val as Record<string, unknown>, 'token'),
  }));

  const codex = expectObject(obj, 'codex', defaults.codex, (val) => ({
    command: expectString(val as Record<string, unknown>, 'command', defaults.codex.command),
    model: expectString(val as Record<string, unknown>, 'model', DEFAULT_CODEX_MODEL),
    reasoningEffort: expectEnum(
      val as Record<string, unknown>,
      'reasoningEffort',
      CODEX_REASONING_EFFORTS,
      DEFAULT_CODEX_REASONING_EFFORT,
    ),
    speed: expectEnum(
      val as Record<string, unknown>,
      'speed',
      CODEX_SPEEDS,
      DEFAULT_CODEX_SPEED,
    ),
    sandbox: expectEnum(
      val as Record<string, unknown>,
      'sandbox',
      ['read-only', 'workspace-write', 'danger-full-access'] as const,
      defaults.codex.sandbox,
    ),
    search: expectBoolean(
      val as Record<string, unknown>,
      'search',
      defaults.codex.search,
    ),
  }));

  const retention = expectObject(obj, 'retention', defaults.retention, (val) => ({
    keepTranscripts: expectBoolean(
      val as Record<string, unknown>,
      'keepTranscripts',
      defaults.retention.keepTranscripts,
    ),
    keepTestLogs: expectBoolean(
      val as Record<string, unknown>,
      'keepTestLogs',
      defaults.retention.keepTestLogs,
    ),
  }));

  const displayVerbosity = expectEnum(
    obj,
    'displayVerbosity',
    ['compact', 'tool-results', 'full'] as const,
    defaults.displayVerbosity,
  );

  return {
    executionTarget,
    branchNaming,
    github,
    codex,
    retention,
    displayVerbosity,
  };
}

export class ConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigValidationError';
  }
}

function expectString(
  obj: Record<string, unknown>,
  key: string,
  fallback: string,
): string {
  if (!(key in obj)) return fallback;
  if (typeof obj[key] !== 'string') {
    throw new ConfigValidationError(`"${key}" must be a string`);
  }
  return obj[key] as string;
}

function expectOptionalString(
  obj: Record<string, unknown>,
  key: string,
): string | undefined {
  if (!(key in obj)) return undefined;
  if (typeof obj[key] !== 'string') {
    throw new ConfigValidationError(`"${key}" must be a string`);
  }
  return obj[key] as string;
}

function expectBoolean(
  obj: Record<string, unknown>,
  key: string,
  fallback: boolean,
): boolean {
  if (!(key in obj)) return fallback;
  if (typeof obj[key] !== 'boolean') {
    throw new ConfigValidationError(`"${key}" must be a boolean`);
  }
  return obj[key] as boolean;
}

function expectEnum<T extends string>(
  obj: Record<string, unknown>,
  key: string,
  values: readonly T[],
  fallback: T,
): T {
  if (!(key in obj)) return fallback;
  if (typeof obj[key] !== 'string' || !values.includes(obj[key] as T)) {
    throw new ConfigValidationError(`"${key}" must be one of: ${values.join(', ')}`);
  }
  return obj[key] as T;
}

function expectObject<T>(
  obj: Record<string, unknown>,
  key: string,
  fallback: T,
  parse: (val: unknown) => T,
): T {
  if (!(key in obj)) return fallback;
  if (typeof obj[key] !== 'object' || obj[key] === null) {
    throw new ConfigValidationError(`"${key}" must be an object`);
  }
  return parse(obj[key]);
}
