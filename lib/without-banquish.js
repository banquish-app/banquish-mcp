// The MCP server banquish-mcp runs when Banquish isn't installed. It lists Banquish's
// real tools (tools.json, exported from the app by scripts/export-tools.mjs), so MCP
// clients and directories can see what Banquish offers, and answers every tool call
// with how to install Banquish. Newline-delimited JSON-RPC over stdio, as the app's
// stdio shim speaks it; stdout carries nothing else.
import { readFileSync } from 'node:fs';

const { appVersion, instructions, tools } = JSON.parse(
  readFileSync(new URL('../tools.json', import.meta.url), 'utf8'),
);
const toolNames = new Set(tools.map((tool) => tool.name));
const serverInfo = { name: 'Banquish', version: appVersion };
const capabilities = { tools: {} };

// 2025-era versions, negotiated through initialize; the first is offered to a client
// asking for one not listed. The app accepts 2025-11-25 alone; the older ones are
// here so older introspection clients work.
const LEGACY_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'];
// 2026-07-28 and later: every request carries its version in a _meta envelope, and
// server/discover replaces initialize.
const MODERN_VERSIONS = ['2026-07-28'];
const PROTOCOL_VERSION_KEY = 'io.modelcontextprotocol/protocolVersion';
const REQUIRED_ENVELOPE_KEYS = [PROTOCOL_VERSION_KEY, 'io.modelcontextprotocol/clientCapabilities'];
const SERVER_INFO_KEY = 'io.modelcontextprotocol/serverInfo';

class RpcError extends Error {
  constructor(code, message, data) {
    super(message);
    this.code = code;
    this.data = data;
  }
}

export function installSteps(shim) {
  return [
    `Banquish isn't set up on this computer: ${shim} is missing.`,
    '',
    'banquish-mcp runs the MCP server of Banquish, a Mac app (Apple silicon) that composes live parts of real pages into a Workspace you see.',
    '',
    '1. Install Banquish: download it from https://banquish.space, or run',
    '     brew install --cask banquish-app/tap/banquish',
    `2. Open Banquish once. That installs ${shim}.`,
    '3. Restart your MCP client.',
    '',
  ].join('\n');
}

function callTool(params, shim) {
  if (!toolNames.has(params?.name)) {
    throw new RpcError(-32602, `Tool ${params?.name} not found`);
  }
  return { content: [{ type: 'text', text: installSteps(shim) }], isError: true };
}

function answerLegacy(method, params, shim) {
  switch (method) {
    case 'initialize': {
      const requested = params?.protocolVersion;
      const protocolVersion = LEGACY_VERSIONS.includes(requested) ? requested : LEGACY_VERSIONS[0];
      return { protocolVersion, capabilities, serverInfo, instructions };
    }
    case 'ping':
      return {};
    case 'tools/list':
      return { tools };
    case 'tools/call':
      return callTool(params, shim);
    default:
      throw new RpcError(-32601, 'Method not found');
  }
}

// Shapes the app's SDK gives 2026-07-28 results: a resultType, the server's identity
// in _meta, and cache hints on the listings.
function answerModern(method, params, shim) {
  const meta = params._meta;
  const missing = REQUIRED_ENVELOPE_KEYS.filter((key) => !(key in meta));
  if (missing.length > 0) {
    throw new RpcError(-32602, `Request is missing the required _meta envelope for protocol revision 2026-07-28 (${missing.join(', ')})`);
  }
  const requested = meta[PROTOCOL_VERSION_KEY];
  if (!MODERN_VERSIONS.includes(requested)) {
    throw new RpcError(-32022, `Unsupported protocol version: ${requested}`, {
      supported: MODERN_VERSIONS,
      requested,
    });
  }
  const complete = { resultType: 'complete', _meta: { [SERVER_INFO_KEY]: serverInfo } };
  const cached = { resultType: 'complete', ttlMs: 0, cacheScope: 'private', _meta: complete._meta };
  switch (method) {
    case 'server/discover':
      return { supportedVersions: MODERN_VERSIONS, capabilities, instructions, ...cached };
    case 'tools/list':
      return { tools, ...cached };
    case 'tools/call':
      return { ...callTool(params, shim), ...complete };
    default:
      throw new RpcError(-32601, 'Method not found');
  }
}

function answer(message, shim) {
  const meta = message.params?._meta;
  if (meta && typeof meta === 'object' && PROTOCOL_VERSION_KEY in meta) {
    return answerModern(message.method, message.params, shim);
  }
  return answerLegacy(message.method, message.params, shim);
}

function send(message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
}

function receive(line, shim) {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    send({ id: null, error: { code: -32700, message: 'Parse error' } });
    return;
  }
  // Notifications and responses need no answer.
  if (typeof message?.method !== 'string' || !('id' in message)) return;
  try {
    send({ id: message.id, result: answer(message, shim) });
  } catch (err) {
    const { code = -32603, message: text, data } = err;
    send({ id: message.id, error: { code, message: text, ...(data !== undefined && { data }) } });
  }
}

export function serveWithoutBanquish(shim) {
  process.stderr.write(installSteps(shim));
  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) receive(line, shim);
    }
  });
  // When the client closes stdin, the process ends by itself once stdout drains.
}
