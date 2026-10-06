#!/usr/bin/env node
// Runs Banquish's MCP server for any MCP client: the stdio shim that the Banquish app
// installs at ~/.banquish/bin/banquish, with this process's stdio passed straight through.
// Without the shim, it says how to install Banquish and exits non-zero.
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

if (!installed()) {
  process.stderr.write(
    [
      `Banquish isn't set up on this computer: ${shim} is missing.`,
      '',
      "banquish-mcp runs the MCP server of Banquish, a Mac app (Apple silicon) that composes live parts of real pages into a Workspace you see.",
      '',
      '1. Install Banquish: download it from https://banquish.space, or run',
      '     brew install --cask banquish-app/tap/banquish',
      '2. Open Banquish. Under "Connect your agent", open "Any other MCP client" and click Copy.',
      `   That installs ${shim}.`,
      '3. Restart your MCP client.',
      '',
    ].join('\n'),
  );
  process.exit(1);
}

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
