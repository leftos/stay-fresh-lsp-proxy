#!/usr/bin/env node

import { main as setupMain } from "./setup.js";
import { startProxy } from "./proxy.js";

const firstArg = process.argv[2];

if (firstArg === "setup") {
  // Remove "setup" from argv so setup's parseArgs sees the flags directly
  process.argv.splice(2, 1);
  setupMain();
} else {
  startProxy();
}
