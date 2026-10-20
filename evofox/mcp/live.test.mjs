/**
 * Live check of the MCP server against the keyboard: read the board, make a
 * change, read it back, put it back. Run it with `node mcp/live.test.mjs`.
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
    }, 20000);
  });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  return answer;
}

async function tool(name, args = {}) {
  const answer = await request('tools/call', { name, arguments: args });
  if (answer.result?.isError) throw new Error(`${name}: ${answer.result.content[0].text}`);
  return answer.result;
}

try {
  await request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'live-test', version: '1.0.0' },
  });

  const status = (await tool('ronin_status')).structuredContent;
  console.log('status:', status.device.vendor_id, status.device.product_id, 'fw', status.device.firmware,
    '| profile', status.active_profile, '|', status.lighting.mode_name, '|', status.connection);
  assert.ok(status.device.firmware.startsWith('0x'), 'the firmware must be reported');

  const keymap = (await tool('ronin_keymap_read', { layer: 0 })).structuredContent;
  console.log('keymap: layer', keymap.layer, 'with', keymap.keys.length, 'assigned keys');
  const sample = keymap.keys.find(row => row.key === 'F1') || keymap.keys[0];
  assert.ok(sample, 'the layer must have keys');

  // change one key, read it back, then put the original assignment back
  const temporary = sample.assigned === 'Unassigned' ? 'F13' : 'Unassigned';
  const written = (await tool('ronin_keymap_write', {
    layer: 0,
    assignments: [{ key: sample.key, value: temporary }],
  })).structuredContent;
  assert.equal(written.all_verified, true, 'the change must verify');
  console.log('wrote', sample.key, '->', temporary, '(verified)');

  const restored = (await tool('ronin_keymap_write', {
    layer: 0,
    assignments: [{ key: sample.key, value: sample.assigned || 'Unassigned' }],
  })).structuredContent;
  assert.equal(restored.all_verified, true, 'the restore must verify');
  console.log('restored', sample.key, '->', sample.assigned || 'Unassigned');

  const lighting = (await tool('ronin_lighting_read', {})).structuredContent;
  const writtenLighting = (await tool('ronin_lighting_write', {
    brightness: lighting.lighting.brightness,
    speed: lighting.lighting.speed,
  })).structuredContent;
  assert.equal(writtenLighting.lighting.brightness, lighting.lighting.brightness);
  console.log('lighting write verified:', writtenLighting.lighting.mode_name);

  const colours = (await tool('ronin_colours_read', { all: true })).structuredContent;
  console.log('colour table:', colours.entries.length, 'entries,', colours.total_slots, 'slots');
  const painted = (await tool('ronin_colours_write', {
    assignments: [{ key: sample.key, colour: '#010203' }],
    set_mode: false,
  })).structuredContent;
  assert.equal(painted.all_verified, true, 'the colour write must verify');
  const original = colours.entries.find(entry => entry.key === sample.key)?.colour || '#000000';
  const back = (await tool('ronin_colours_write', {
    assignments: [{ key: sample.key, colour: original }],
    set_mode: false,
  })).structuredContent;
  assert.equal(back.all_verified, true, 'the colour restore must verify');
  console.log('per-key colour write and restore verified');

  console.log('ok: live read, write, verify and restore');
} finally {
  child.kill();
}
