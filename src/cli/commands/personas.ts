import type { Command } from 'commander';
import { select, input, confirm, checkbox } from '@inquirer/prompts';
import {
  listPersonas,
  getPersonaContent,
  addCustomPersona,
  removeCustomPersona,
  isBuiltIn,
  PersonaError,
  validateSwarmSelection,
} from '../../core/personas/index.js';
import { loadConfig, saveConfig, configExists } from '../../core/config/index.js';

export function registerPersonasCommand(program: Command): void {
  program
    .command('personas')
    .description('Manage built-in and custom personas and choose the global default swarm')
    .action(async () => {
      if (!configExists()) {
        console.log('Run "hydraz config" first to initialize.\n');
        return;
      }

      await personasMenu();
    });
}

async function personasMenu(): Promise<void> {
  const config = loadConfig();
  console.log(`\nCurrent default swarm: ${config.defaultPersonas.join(', ')}\n`);

  const action = await select({
    message: 'Personas',
    choices: [
      { name: 'Change default swarm', value: 'change-swarm' as const },
      { name: 'List all personas', value: 'list' as const },
      { name: 'View persona', value: 'view' as const },
      { name: 'Add custom persona', value: 'add' as const },
      { name: 'Remove custom persona', value: 'remove' as const },
      { name: 'Exit', value: 'exit' as const },
    ],
  });

  switch (action) {
    case 'change-swarm':
      await changeDefaultSwarm();
      break;
    case 'list':
      showPersonaList();
      break;
    case 'view':
      await viewPersona();
      break;
    case 'add':
      await addPersona();
      break;
    case 'remove':
      await removePersona();
      break;
    case 'exit':
      return;
  }

  await personasMenu();
}

export async function changeDefaultSwarm(configDir?: string): Promise<void> {
  const personas = listPersonas(configDir);
  const config = loadConfig(configDir);

  if (personas.length < 3) {
    console.log('\nNot enough personas available. Need at least 3.\n');
    return;
  }

  const selected = await checkbox({
    message: 'Select exactly 3 personas for your default swarm',
    choices: personas.map((p) => ({
      name: `${p.displayName}${p.isBuiltIn ? '' : ' (custom)'}`,
      value: p.name,
      checked: config.defaultPersonas.includes(p.name),
    })),
  });

  try {
    const availableNames = personas.map((p) => p.name);
    const validated = validateSwarmSelection(selected, availableNames);
    config.defaultPersonas = validated;
    saveConfig(config, configDir);
    console.log(`\nDefault swarm set to: ${validated.join(', ')}\n`);
  } catch (err) {
    if (err instanceof PersonaError) {
      console.log(`\n${err.message}\n`);
    } else {
      throw err;
    }
  }
}

function showPersonaList(): void {
  const personas = listPersonas();

  console.log('\nAvailable personas:');
  for (const p of personas) {
    const tag = p.isBuiltIn ? 'built-in' : 'custom';
    console.log(`  ${p.displayName} (${p.name}) [${tag}]`);
  }
  console.log();
}

async function viewPersona(): Promise<void> {
  const personas = listPersonas();
  const name = await select({
    message: 'Select persona to view',
    choices: personas.map((p) => ({
      name: `${p.displayName}${p.isBuiltIn ? '' : ' (custom)'}`,
      value: p.name,
    })),
  });

  const content = getPersonaContent(name);
  if (content) {
    console.log(`\n--- ${name} ---`);
    console.log(content);
    console.log('--- End ---\n');
  }
}

async function addPersona(): Promise<void> {
  const name = await input({
    message: 'Persona name (lowercase, hyphens allowed)',
    validate: (val) => {
      if (/^[a-z][a-z0-9-]*[a-z0-9]$/.test(val) && val.length >= 2 && val.length <= 64) {
        return true;
      }
      return 'Use 2-64 characters: lowercase letters, numbers, and hyphens.';
    },
  });

  if (isBuiltIn(name)) {
    console.log(`\n"${name}" is a built-in persona and cannot be overwritten.\n`);
    return;
  }

  const content = `# ${name.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}

Describe this persona's role, perspective, and behavior here.
`;

  try {
    addCustomPersona(name, content);
    const { resolveConfigPaths } = await import('../../core/config/paths.js');
    const paths = resolveConfigPaths();
    console.log(`\nPersona "${name}" created.`);
    console.log(`Edit the prompt at: ${paths.personasDir}/${name}.md\n`);
  } catch (err) {
    if (err instanceof PersonaError) {
      console.log(`\n${err.message}\n`);
    } else {
      throw err;
    }
  }
}

async function removePersona(): Promise<void> {
  const personas = listPersonas().filter((p) => !p.isBuiltIn);

  if (personas.length === 0) {
    console.log('\nNo custom personas to remove.\n');
    return;
  }

  const name = await select({
    message: 'Select custom persona to remove',
    choices: personas.map((p) => ({
      name: p.displayName,
      value: p.name,
    })),
  });

  const shouldRemove = await confirm({
    message: `Remove "${name}"?`,
    default: false,
  });

  if (shouldRemove) {
    try {
      removeCustomPersona(name);
      console.log(`\nPersona "${name}" removed.\n`);
    } catch (err) {
      if (err instanceof PersonaError) {
        console.log(`\n${err.message}\n`);
      } else {
        throw err;
      }
    }
  }
}
