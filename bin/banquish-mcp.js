#!/usr/bin/env node
// Runs Banquish's MCP server for any MCP client: the stdio shim that the Banquish app
// installs at ~/.banquish/bin/banquish, with this process's stdio passed straight through.
// Without the shim, it says how to install Banquish and serves Banquish's tool list
// itself, answering every tool call with those install steps.
import { spawn } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const shim = join(homedir(), '.banquish', 'bin', 'banquish');

function installed() {
  try {
    accessSync(shim, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function relay() {
  const child = spawn(shim, ['mcp'], { stdio: 'inherit' });

  // The client stops the server by signalling this process; the shim is the server.
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => child.kill(signal));
  }

  child.on('error', (err) => {
    process.stderr.write(`Couldn't run ${shim}: ${err.message}\n`);
    process.exit(1);
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      // Die of the same signal, so the client sees how the server ended.
      process.removeAllListeners(signal);
      process.kill(process.pid, signal);
    } else {
      process.exit(code ?? 1);
    }
  });
}

if (installed()) {
  relay();
} else {
  // Loaded only here, so the relay never reads tools.json.
  const { serveWithoutBanquish } = await import('../lib/without-banquish.js');
  serveWithoutBanquish(shim);
}
