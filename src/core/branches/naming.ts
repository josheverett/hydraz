export function suggestBranchName(sessionName: string, prefix: string = 'hydraz/'): string {
  return `${prefix}${sessionName}`;
}

export function isValidBranchName(name: string): boolean {
  if (name.length === 0 || name.length > 200) return false;
  if (name.startsWith('-') || name.endsWith('.') || name.endsWith('/')) return false;
  if (name.includes('..') || name.includes(' ') || name.includes('~')) return false;
  if (name.includes('^') || name.includes(':') || name.includes('\\')) return false;
  if (name.includes('?') || name.includes('*') || name.includes('[')) return false;
  if (name.includes('@{')) return false;
  return /^[\x20-\x7E]+$/.test(name);
}

export function isValidSessionName(name: string): boolean {
  return /^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(name) && name.length >= 2 && name.length <= 64;
}
