import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, join, relative, resolve, isAbsolute } from 'node:path';
import { resolveConfigPaths } from '../config/paths.js';
import { BUILT_IN_PERSONAS } from '../config/schema.js';
import { isValidPersonaName } from './naming.js';

export { isValidPersonaName } from './naming.js';

export interface PersonaInfo {
  name: string;
  displayName: string;
  isBuiltIn: boolean;
  filePath: string;
}

export function toDisplayName(name: string): string {
  return name
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function isBuiltIn(name: string): boolean {
  return (BUILT_IN_PERSONAS as readonly string[]).includes(name);
}

function isResolvedFileInsideDir(dirReal: string, fileReal: string): boolean {
  const rel = relative(resolve(dirReal), resolve(fileReal));
  if (rel === '') {
    return false;
  }
  if (rel.startsWith('..')) {
    return false;
  }
  return !isAbsolute(rel);
}

/** Returns the joined path only if it resolves under the real personas directory (blocks symlink escape). */
function resolveSafePersonaFilePath(name: string, configDir?: string): string | null {
  if (!isValidPersonaName(name)) {
    return null;
  }
  const paths = resolveConfigPaths(configDir);
  if (!existsSync(paths.personasDir)) {
    return null;
  }
  let personasDirReal: string;
  try {
    personasDirReal = realpathSync(paths.personasDir);
  } catch {
    return null;
  }
  const filePath = join(paths.personasDir, `${name}.md`);
  if (!existsSync(filePath)) {
    return null;
  }
  let fileReal: string;
  try {
    fileReal = realpathSync(filePath);
  } catch {
    return null;
  }
  if (!isResolvedFileInsideDir(personasDirReal, fileReal)) {
    return null;
  }
  return filePath;
}

export function listPersonas(configDir?: string): PersonaInfo[] {
  const paths = resolveConfigPaths(configDir);

  if (!existsSync(paths.personasDir)) {
    return [];
  }

  const files = readdirSync(paths.personasDir).filter((f) => f.endsWith('.md'));

  return files
    .map((file) => {
      const name = basename(file, '.md');
      return {
        name,
        displayName: toDisplayName(name),
        isBuiltIn: isBuiltIn(name),
        filePath: join(paths.personasDir, file),
      };
    })
    .sort((a, b) => {
      if (a.isBuiltIn && !b.isBuiltIn) return -1;
      if (!a.isBuiltIn && b.isBuiltIn) return 1;
      return a.name.localeCompare(b.name);
    });
}

export function getPersonaContent(name: string, configDir?: string): string | null {
  const filePath = resolveSafePersonaFilePath(name, configDir);
  if (!filePath) {
    return null;
  }
  return readFileSync(filePath, 'utf-8');
}

export function personaExists(name: string, configDir?: string): boolean {
  return resolveSafePersonaFilePath(name, configDir) !== null;
}

export function addCustomPersona(name: string, content: string, configDir?: string): void {
  if (isBuiltIn(name)) {
    throw new PersonaError(`"${name}" is a built-in persona and cannot be overwritten`);
  }

  if (!isValidPersonaName(name)) {
    throw new PersonaError(
      `"${name}" is not a valid persona name. Use lowercase letters, numbers, and hyphens.`,
    );
  }

  const paths = resolveConfigPaths(configDir);
  mkdirSync(paths.personasDir, { recursive: true, mode: 0o700 });

  const filePath = join(paths.personasDir, `${name}.md`);
  if (existsSync(filePath)) {
    try {
      if (lstatSync(filePath).isSymbolicLink()) {
        throw new PersonaError(`Refusing to write persona "${name}": target path is a symlink`);
      }
    } catch (err) {
      if (err instanceof PersonaError) throw err;
      throw new PersonaError(`Cannot verify persona file path for "${name}"`);
    }
  }

  writeFileSync(filePath, content, { mode: 0o600 });
}

export function removeCustomPersona(name: string, configDir?: string): void {
  if (isBuiltIn(name)) {
    throw new PersonaError(`"${name}" is a built-in persona and cannot be removed`);
  }

  const safePath = resolveSafePersonaFilePath(name, configDir);
  if (!safePath) {
    throw new PersonaError(`Persona "${name}" does not exist`);
  }

  unlinkSync(safePath);
}

export class PersonaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PersonaError';
  }
}
