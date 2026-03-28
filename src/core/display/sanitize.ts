const ANSI_ESCAPE_PATTERN = /\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\))/g;
const INLINE_WHITESPACE_CONTROL_PATTERN = /[\t\r\n]+/g;
const INLINE_CONTROL_PATTERN = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;
const MULTILINE_CONTROL_PATTERN = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;

export function sanitizeMultilineTerminalText(text: string): string {
  return text
    .replace(ANSI_ESCAPE_PATTERN, '')
    .replace(/\t/g, ' ')
    .replace(MULTILINE_CONTROL_PATTERN, '');
}

export function sanitizeInlineTerminalText(text: string): string {
  return text
    .replace(ANSI_ESCAPE_PATTERN, '')
    .replace(INLINE_WHITESPACE_CONTROL_PATTERN, ' ')
    .replace(INLINE_CONTROL_PATTERN, '')
    .replace(/\s+/g, ' ')
    .trim();
}
