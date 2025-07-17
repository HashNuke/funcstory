#!/usr/bin/env node

import { main } from './index.js';

// CLI entry point - auto-execute main function
const exitCode = main();
process.exit(exitCode);