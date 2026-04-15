import type { Command } from 'commander';
import { registerAttachCommand } from './attach.js';
import { registerCleanCommand } from './clean.js';
import { registerConfigCommand } from './config.js';
import { registerEventsCommand } from './events.js';
import { registerHelloWorldCommand } from './hello-world.js';
import { registerMcpCommand } from './mcp.js';
import { registerPersonasCommand } from './personas.js';
import { registerResumeCommand } from './resume.js';
import { registerReviewCommand } from './review.js';
import { registerRunCommand } from './run.js';
import { registerSessionsCommand } from './sessions.js';
import { registerStatusCommand } from './status.js';
import { registerStopCommand } from './stop.js';

export function registerCommands(program: Command): void {
  registerConfigCommand(program);
  registerRunCommand(program);
  registerHelloWorldCommand(program);
  registerAttachCommand(program);
  registerSessionsCommand(program);
  registerStatusCommand(program);
  registerReviewCommand(program);
  registerResumeCommand(program);
  registerStopCommand(program);
  registerEventsCommand(program);
  registerPersonasCommand(program);
  registerMcpCommand(program);
  registerCleanCommand(program);
}
