#!/usr/bin/env node

import { createProgram } from './program.js';
import { gracefulShutdown } from '../core/orchestration/shutdown.js';

process.on('SIGINT', () => gracefulShutdown());
process.on('SIGTERM', () => gracefulShutdown());

const program = createProgram();
program.parse();
