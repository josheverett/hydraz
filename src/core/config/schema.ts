export type ExecutionTarget = 'local' | 'cloud';
export type AuthMode = 'claude-ai-oauth' | 'api-key';

export interface BranchNamingConfig {
  prefix: string;
}

export interface ClaudeAuthConfig {
  mode: AuthMode;
}

export interface RetentionConfig {
  keepTranscripts: boolean;
  keepTestLogs: boolean;
}

export interface HydrazConfig {
  version: string;
  executionTarget: ExecutionTarget;
  defaultPersonas: [string, string, string];
  branchNaming: BranchNamingConfig;
  claudeAuth: ClaudeAuthConfig;
  retention: RetentionConfig;
}

export const BUILT_IN_PERSONAS = [
  'architect',
  'implementer',
  'verifier',
  'skeptic',
  'product-generalist',
  'performance-reliability',
] as const;

export type BuiltInPersona = (typeof BUILT_IN_PERSONAS)[number];

export const DEFAULT_SWARM: [string, string, string] = [
  'architect',
  'implementer',
  'verifier',
];

export function createDefaultConfig(): HydrazConfig {
  return {
    version: '1',
    executionTarget: 'local',
    defaultPersonas: [...DEFAULT_SWARM],
    branchNaming: {
      prefix: 'hydraz/',
    },
    claudeAuth: {
      mode: 'claude-ai-oauth',
    },
    retention: {
      keepTranscripts: false,
      keepTestLogs: false,
    },
  };
}

export function validateConfig(data: unknown): HydrazConfig {
  if (typeof data !== 'object' || data === null) {
    throw new ConfigValidationError('Config must be a non-null object');
  }

  const obj = data as Record<string, unknown>;
  const defaults = createDefaultConfig();

  const version = expectString(obj, 'version', defaults.version);

  const executionTarget = expectEnum(
    obj,
    'executionTarget',
    ['local', 'cloud'] as const,
    defaults.executionTarget,
  );

  const defaultPersonas = expectPersonasTuple(obj, defaults.defaultPersonas);

  const branchNaming = expectObject(obj, 'branchNaming', defaults.branchNaming, (val) => ({
    prefix: expectString(val as Record<string, unknown>, 'prefix', defaults.branchNaming.prefix),
  }));

  const claudeAuth = expectObject(obj, 'claudeAuth', defaults.claudeAuth, (val) => ({
    mode: expectEnum(
      val as Record<string, unknown>,
      'mode',
      ['claude-ai-oauth', 'api-key'] as const,
      defaults.claudeAuth.mode,
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

  return { version, executionTarget, defaultPersonas, branchNaming, claudeAuth, retention };
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

function expectPersonasTuple(
  obj: Record<string, unknown>,
  fallback: [string, string, string],
): [string, string, string] {
  if (!('defaultPersonas' in obj)) return fallback;

  const val = obj['defaultPersonas'];
  if (!Array.isArray(val)) {
    throw new ConfigValidationError('"defaultPersonas" must be an array');
  }
  if (val.length !== 3) {
    throw new ConfigValidationError('"defaultPersonas" must contain exactly 3 personas');
  }
  if (!val.every((v) => typeof v === 'string' && v.length > 0)) {
    throw new ConfigValidationError('"defaultPersonas" entries must be non-empty strings');
  }
  return val as [string, string, string];
}
