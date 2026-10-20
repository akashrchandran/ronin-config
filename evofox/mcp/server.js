#!/usr/bin/env node
/**
 * ronin-mcp — an MCP server for the EvoFox Ronin keyboard (0x320F:0x5055).
 *
 * The server speaks JSON-RPC 2.0 over stdio, the way MCP clients expect, and
 * exposes the keyboard as a set of tools: read the keymap, write the keymap,
 * read and write the lighting, read and write the per-key colours, write
 * macros, reset the board.
 *
 *   node mcp/server.js
 *
 * Environment:
 *   RONIN_TRANSPORT  auto (default) | bridge | hid
 *   RONIN_BRIDGE     ws://127.0.0.1:5173/bridge
 */
import { createInterface } from 'node:readline';

import { TOOLS, callTool } from './tools.js';
import { RoninSession } from './session.js';

const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const SERVER_INFO = { name: 'ronin-keyboard', title: 'EvoFox Ronin keyboard', version: '1.0.0' };

const INSTRUCTIONS = [
  'Drive an EvoFox Ronin keyboard over USB.',
  'Call ronin_status first to see the firmware, the active profile and the lighting.',
  'ronin_keymap_read lists the keys of a layer with their physical names, so writes can name keys ("F5", "Space") instead of slot numbers.',
  'ronin_effects lists the lighting effects, directions and report rates.',
  'Per-key colours are only visible while the board runs the per-key mode (Custom, mode 19); ronin_colours_write switches to it by default.',
  'Every write is read back and reports what the keyboard really holds.',
].join(' ');

const session = new RoninSession({ transport: process.env.RONIN_TRANSPORT || 'auto' });

function log(message) {
  process.stderr.write(`[ronin-mcp] ${message}\n`);
}

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

function reply(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function fail(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

async function handle(message) {
  const { method, id } = message;
  const isNotification = id === undefined || id === null;

  switch (method) {
    case 'initialize': {
      const wanted = message.params?.protocolVersion;
      const protocolVersion = PROTOCOL_VERSIONS.includes(wanted) ? wanted : PROTOCOL_VERSIONS[0];
      reply(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
      return;
    }

    case 'notifications/initialized':
    case 'notifications/cancelled':
    case 'notifications/progress':
      return;

    case 'ping':
      if (!isNotification) reply(id, {});
      return;

    case 'tools/list':
      reply(id, {
        tools: TOOLS.map(tool => ({
          name: tool.name,
          title: tool.title,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      });
      return;

    case 'tools/call': {
      const name = message.params?.name;
      const args = message.params?.arguments ?? {};
      const tool = TOOLS.find(candidate => candidate.name === name);
      if (!tool) {
        fail(id, -32602, `Unknown tool: ${name}`);
        return;
      }
      try {
        const result = await callTool(tool, args, session);
        reply(id, result);
      } catch (error) {
        log(`${name} failed: ${error.message}`);
        reply(id, {
          content: [{ type: 'text', text: `${name} failed: ${error.message}` }],
          isError: true,
        });
      }
      return;
    }

    case 'resources/list':
      reply(id, { resources: [] });
      return;

    case 'prompts/list':
      reply(id, { prompts: [] });
      return;

    default:
      if (isNotification) return;
      fail(id, -32601, `Method not found: ${method}`);
  }
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });

lines.on('line', async line => {
  const text = line.trim();
  if (!text) return;
  let message;
  try {
    message = JSON.parse(text);
  } catch {
    log('ignoring a line that is not JSON');
    return;
  }
  if (!message || message.jsonrpc !== '2.0') {
    log('ignoring a message that is not JSON-RPC 2.0');
    return;
  }
  try {
    await handle(message);
  } catch (error) {
    log(`error while handling ${message.method}: ${error.stack || error.message}`);
    if (message.id !== undefined && message.id !== null) {
      fail(message.id, -32603, error.message);
    }
  }
});

lines.on('close', async () => {
  await session.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  await session.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await session.close();
  process.exit(0);
});
