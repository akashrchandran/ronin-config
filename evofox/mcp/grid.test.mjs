/**
 * Live check of the MCP grid painting: a small text grid is mapped onto the
 * physical board and read back.
 */
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

const GRID = [
  'ff0000 000000 000000 000000 000000 ff0000',
  '000000 ff0000 000000 000000 ff0000 000000',
  '000000 000000 ff0000 ff0000 000000 000000',
  '000000 000000 000000 000000 000000 000000',
];

try {
  await request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'grid-test', version: '1.0.0' },
  });

  const written = await tool('ronin_colours_write', { grid: GRID, set_mode: true });
  const data = written.structuredContent;
  console.log('grid painted:', data.changes.length, 'keys, verified:', data.all_verified);
  const byColour = new Map();
  for (const change of data.changes) {
    if (!byColour.has(change.colour)) byColour.set(change.colour, []);
    byColour.get(change.colour).push(change.key);
  }
  for (const [colour, keys] of byColour) {
    console.log(' ', colour, '->', keys.length, 'keys:', keys.slice(0, 8).join(' '));
  }
} finally {
  child.kill();
}
