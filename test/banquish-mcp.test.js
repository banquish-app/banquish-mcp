import { spawn } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';

const bin = new URL('../bin/banquish-mcp.js', import.meta.url).pathname;
const exported = JSON.parse(readFileSync(new URL('../tools.json', import.meta.url), 'utf8'));
const homes = [];

after(() => {
  for (const home of homes) rmSync(home, { recursive: true, force: true });
});

function emptyHome() {
  const home = mkdtempSync(join(tmpdir(), 'banquish-mcp-test-'));
  homes.push(home);
  return home;
}

// Runs banquish-mcp with HOME at `home`, writes `messages` to its stdin, closes stdin,
// and resolves with its stdout split into lines, its stderr, and its exit code.
function run(home, messages) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin], {
      env: { ...process.env, HOME: home },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ lines: stdout.split('\n').filter(Boolean), stderr, code });
    });
    for (const message of messages) child.stdin.write(`${JSON.stringify(message)}\n`);
    child.stdin.end();
  });
}

async function exchange(messages) {
  const { lines, stderr, code } = await run(emptyHome(), messages);
  const replies = lines.map((line) => JSON.parse(line));
  return { replies, byId: new Map(replies.map((reply) => [reply.id, reply])), stderr, code };
}

const initialize = (protocolVersion) => ({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion, capabilities: {}, clientInfo: { name: 'test', version: '0' } },
});
const initialized = { jsonrpc: '2.0', method: 'notifications/initialized' };
const modernMeta = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientCapabilities': {},
  'io.modelcontextprotocol/clientInfo': { name: 'test', version: '0' },
};

for (const version of ['2025-11-25', '2025-06-18']) {
  test(`initialize under ${version} offers ${version} and the app's instructions`, async () => {
    const { byId } = await exchange([initialize(version), initialized]);
    const { result } = byId.get(1);
    assert.equal(result.protocolVersion, version);
    assert.deepEqual(result.serverInfo, { name: 'Banquish', version: exported.appVersion });
    assert.ok(result.capabilities.tools);
    assert.equal(result.instructions, exported.instructions);
  });
}

test('initialize under an unknown version offers the latest', async () => {
  const { byId } = await exchange([initialize('2024-11-05')]);
  assert.equal(byId.get(1).result.protocolVersion, '2025-11-25');
});

test("tools/list lists the app's 19 tools, as tools.json has them", async () => {
  const { byId } = await exchange([
    initialize('2025-11-25'),
    initialized,
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    { jsonrpc: '2.0', id: 3, method: 'ping' },
  ]);
  const { tools } = byId.get(2).result;
  assert.equal(tools.length, 19);
  assert.deepEqual(tools, exported.tools);
  assert.deepEqual(byId.get(3).result, {});
});

test('tools/call answers isError with the install steps', async () => {
  const { byId, stderr, code } = await exchange([
    initialize('2025-11-25'),
    initialized,
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'open_page', arguments: { url: 'https://example.com' } } },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'no_such_tool', arguments: {} } },
  ]);
  const { result } = byId.get(2);
  assert.equal(result.isError, true);
  const [content] = result.content;
  assert.equal(content.type, 'text');
  assert.match(content.text, /Banquish isn't set up on this computer/);
  assert.match(content.text, /https:\/\/banquish\.space/);
  assert.match(content.text, /brew install --cask banquish-app\/tap\/banquish/);
  assert.match(content.text, /Open Banquish once/);
  assert.equal(byId.get(3).error.code, -32602);
  // The steps go to stderr once, at start.
  assert.equal(stderr.match(/isn't set up/g).length, 1);
  assert.equal(code, 0);
});

test('2026-07-28: server/discover, tools/list and tools/call through the _meta envelope', async () => {
  const { byId } = await exchange([
    { jsonrpc: '2.0', id: 1, method: 'server/discover', params: { _meta: modernMeta } },
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: { _meta: modernMeta } },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'finish_work', arguments: {}, _meta: modernMeta } },
    { jsonrpc: '2.0', id: 4, method: 'tools/list', params: { _meta: { ...modernMeta, 'io.modelcontextprotocol/protocolVersion': '2027-01-01' } } },
  ]);
  const discover = byId.get(1).result;
  assert.deepEqual(discover.supportedVersions, ['2026-07-28']);
  assert.equal(discover.instructions, exported.instructions);
  assert.equal(discover.resultType, 'complete');
  assert.deepEqual(discover._meta['io.modelcontextprotocol/serverInfo'], { name: 'Banquish', version: exported.appVersion });
  assert.deepEqual(byId.get(2).result.tools, exported.tools);
  const call = byId.get(3).result;
  assert.equal(call.isError, true);
  assert.equal(call.resultType, 'complete');
  assert.match(call.content[0].text, /Open Banquish once/);
  assert.equal(byId.get(4).error.code, -32022);
});

test('stdout carries only JSON-RPC', async () => {
  const { lines } = await run(emptyHome(), [
    initialize('2025-11-25'),
    initialized,
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'open_page', arguments: {} } },
    { jsonrpc: '2.0', id: 4, method: 'resources/list' },
  ]);
  assert.equal(lines.length, 4);
  for (const line of lines) {
    const message = JSON.parse(line);
    assert.equal(message.jsonrpc, '2.0');
    assert.ok('result' in message || 'error' in message);
  }
});

test("with the shim installed, stdio passes straight through to it", async () => {
  const home = emptyHome();
  const binDir = join(home, '.banquish', 'bin');
  mkdirSync(binDir, { recursive: true });
  const shim = join(binDir, 'banquish');
  // A fake shim: checks it was run as `banquish mcp`, echoes stdin back with a prefix,
  // writes a marker to stderr, and exits with a status the relay must pass on.
  writeFileSync(
    shim,
    [
      '#!/bin/sh',
      '[ "$1" = "mcp" ] || exit 64',
      'echo "fake shim on stderr" >&2',
      'while IFS= read -r line; do echo "shim:$line"; done',
      'exit 7',
      '',
    ].join('\n'),
  );
  chmodSync(shim, 0o755);
  const { lines, stderr, code } = await run(home, [{ hello: 1 }, { hello: 2 }]);
  assert.deepEqual(lines, ['shim:{"hello":1}', 'shim:{"hello":2}']);
  assert.equal(stderr, 'fake shim on stderr\n');
  assert.equal(code, 7);
});
