const ANSI_ESCAPE_PATTERN = /\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\))/g;
const INLINE_WHITESPACE_CONTROL_PATTERN = /[\t\r\n]+/g;
const INLINE_CONTROL_PATTERN = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;
const MULTILINE_CONTROL_PATTERN = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;
const REDACTED = '[REDACTED]';
const GITHUB_TOKEN_PATTERN = /\b(?:github_pat|ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]+\b/g;
const OPENAI_KEY_PATTERN = /\bsk-(?:proj-)?[A-Za-z0-9_-]+\b/g;
const AUTH_HEADER_PATTERN = /\b(Authorization|AUTHORIZATION)(\s*:\s*(?:Bearer|basic)\s+)([^\s'",}]+)/g;
const ENV_SECRET_PATTERN = /\b([A-Z0-9_]*(?:TOKEN|API_KEY|SECRET|PASSWORD|AUTHORIZATION)[A-Z0-9_]*)(=)(["']?)([^"'\s]+)(\3)/g;
const JSON_SECRET_PATTERN = /(["'])(token|apiKey|api_key|secret|password|authorization|extraheader)\1(\s*:\s*)(["'])(.*?)\4/gi;

export function redactSecrets(text: string): string {
  return text
    .replace(JSON_SECRET_PATTERN, (_match, quote: string, key: string, separator: string, valueQuote: string) =>
      `${quote}${key}${quote}${separator}${valueQuote}${REDACTED}${valueQuote}`)
    .replace(ENV_SECRET_PATTERN, (_match, key: string, equals: string, quote: string) =>
      `${key}${equals}${quote}${REDACTED}${quote}`)
    .replace(AUTH_HEADER_PATTERN, (_match, header: string, prefix: string) =>
      `${header}${prefix}${REDACTED}`)
    .replace(GITHUB_TOKEN_PATTERN, REDACTED)
    .replace(OPENAI_KEY_PATTERN, REDACTED);
}

export function sanitizeMultilineTerminalText(text: string): string {
  return redactSecrets(text
    .replace(ANSI_ESCAPE_PATTERN, '')
    .replace(/\t/g, ' ')
    .replace(MULTILINE_CONTROL_PATTERN, ''));
}

export function sanitizeInlineTerminalText(text: string): string {
  return redactSecrets(text
    .replace(ANSI_ESCAPE_PATTERN, '')
    .replace(INLINE_WHITESPACE_CONTROL_PATTERN, ' ')
    .replace(INLINE_CONTROL_PATTERN, '')
    .replace(/\s+/g, ' ')
    .trim());
}
