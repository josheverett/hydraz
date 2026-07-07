import type { Command } from 'commander';
import { registerAttachCommand } from './attach.js';
import { registerCleanCommand } from './clean.js';
import { registerConfigCommand } from './config.js';
import { registerLogsCommand } from './logs.js';
import { registerResumeCommand } from './resume.js';
import { registerRunCommand } from './run.js';
import { registerSessionsCommand } from './sessions.js';
import { registerShellCommand } from './shell.js';
import { registerStatusCommand } from './status.js';
import { registerStopCommand } from './stop.js';

export function registerCommands(program: Command): void {
  registerConfigCommand(program);
  registerRunCommand(program);
  registerAttachCommand(program);
  registerSessionsCommand(program);
  registerStatusCommand(program);
  registerResumeCommand(program);
  registerStopCommand(program);
  registerLogsCommand(program);
  registerCleanCommand(program);
  registerShellCommand(program);
}
