#!/usr/bin/env node
// Writes tools.json from the real Banquish app: runs the installed shim
// (~/.banquish/bin/banquish mcp), which relays to the running Banquish, and records
// what it answers to initialize and tools/list. banquish-mcp serves that file when
// Banquish isn't installed. Run it with Banquish open, after the app's tools change.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const shim = join(homedir(), '.banquish', 'bin', 'banquish');
const out = new URL('../tools.json', import.meta.url);

const child = spawn(shim, ['mcp'], { stdio: ['pipe', 'pipe', 'inherit'] });
const pending = new Map();
let buffer = '';

child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf('\n')) >= 0) {
    const message = JSON.parse(buffer.slice(0, newline));
    buffer = buffer.slice(newline + 1);
    const settle = pending.get(message.id);
    if (!settle) continue;
    pending.delete(message.id);
    if (message.error) settle.reject(new Error(`${settle.method}: ${message.error.message}`));
    else settle.resolve(message.result);
  }
});

let nextId = 1;
function request(method, params) {
  const id = nextId++;
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  return new Promise((resolve, reject) => pending.set(id, { method, resolve, reject }));
}

const timeout = setTimeout(() => {
  console.error(`No answer from ${shim} in 30 s. Is Banquish running?`);
  process.exit(1);
}, 30_000);

const init = await request('initialize', {
  protocolVersion: '2025-11-25',
  capabilities: {},
  clientInfo: { name: 'banquish-mcp export-tools', version: '0' },
});
child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
const tools = [];
let cursor;
do {
  const page = await request('tools/list', cursor ? { cursor } : {});
  tools.push(...page.tools);
  cursor = page.nextCursor;
} while (cursor);

clearTimeout(timeout);
child.stdin.end();
child.kill();

const exported = {
  appVersion: init.serverInfo.version,
  instructions: init.instructions,
  tools,
};
writeFileSync(out, `${JSON.stringify(exported, null, 2)}\n`);
console.error(`Wrote ${tools.length} tools from Banquish ${exported.appVersion} to ${out.pathname}`);
