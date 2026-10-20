/**
 * Smoke test for the MCP server: the handshake, the tool catalogue and one
 * tool that does not need the keyboard. Run it with `node mcp/smoke.test.mjs`.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const server = fileURLToPath(new URL('./server.js', import.meta.url));

const child = spawn(process.execPath, [server], { stdio: ['pipe', 'pipe', 'pipe'] });
child.stderr.on('data', chunk => process.stderr.write(`[server] ${chunk}`));

const pending = new Map();
let buffer = '';

child.stdout.on('data', chunk => {
  buffer += chunk.toString();
  let index;
  while ((index = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    const message = JSON.parse(line);
    const resolver = pending.get(message.id);
    if (resolver) {
      pending.delete(message.id);
      resolver(message);
    }
  }
});

let nextId = 0;
function request(method, params) {
  const id = ++nextId;
  const answer = new Promise((resolve, reject) => {
    pending.set(id, resolve);
    setTimeout(() => {
      if (pending.delete(id)) reject(new Error(`${method} timed out`));
    }, 8000);
  });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  return answer;
}

function notify(method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
}

try {
  const init = await request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'smoke-test', version: '1.0.0' },
  });
  assert.equal(init.result.protocolVersion, '2025-06-18');
  assert.equal(init.result.serverInfo.name, 'ronin-keyboard');
  assert.ok(init.result.capabilities.tools, 'the server must advertise tools');
  assert.ok(init.result.instructions.length > 40, 'the server must explain itself');
  notify('notifications/initialized');

  const list = await request('tools/list', {});
  const tools = list.result.tools;
  assert.ok(tools.length >= 8, `expected a useful tool list, got ${tools.length}`);
  for (const tool of tools) {
    assert.ok(tool.name.startsWith('ronin_'), `odd tool name ${tool.name}`);
    assert.ok(tool.description.length > 40, `${tool.name} needs a description`);
    assert.equal(tool.inputSchema.type, 'object');
    for (const required of tool.inputSchema.required ?? []) {
      assert.ok(tool.inputSchema.properties[required], `${tool.name} requires an unknown field ${required}`);
    }
  }

  const unknown = await request('tools/call', { name: 'ronin_nope', arguments: {} });
  assert.ok(unknown.error, 'an unknown tool must be an error');

  const effects = await request('tools/call', { name: 'ronin_effects', arguments: {} });
  assert.equal(effects.result.isError, undefined);
  const effectsData = effects.result.structuredContent;
  assert.ok(effectsData.effects.length >= 18, 'the effect catalogue should be complete');
  assert.ok(effectsData.effects.some(effect => effect.id === 19), 'the per-key mode must be listed');
  assert.ok(effectsData.directions.some(direction => direction.value === 255));

  const badCall = await request('tools/call', {
    name: 'ronin_lighting_write',
    arguments: { mode: 'Not An Effect' },
  });
  assert.equal(badCall.result.isError, true, 'a bad argument must come back as a tool error');
  assert.match(badCall.result.content[0].text, /Unknown effect/);

  const ping = await request('ping', {});
  assert.deepEqual(ping.result, {});

  console.log(`ok: handshake, ${tools.length} tools, error handling`);
} finally {
  child.kill();
}
