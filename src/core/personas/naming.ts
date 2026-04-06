/** Persona names are safe path segments (no traversal). Used by config and filesystem helpers. */
export function isValidPersonaName(name: string): boolean {
  return /^[a-z][a-z0-9-]*[a-z0-9]$/.test(name) && name.length >= 2 && name.length <= 64;
}
