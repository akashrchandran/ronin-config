# Ronin Config

A reverse-engineered configuration tool for the **EvoFox Ronin TKL**
(USB `0x320F:0x5055`) — a browser configurator, a command line client, an
MCP server an AI can drive, and four games you can play on the keyboard's own
lights.

The vendor's configurator for this board is a web app with blocking defects:
its per-key colour write is misaligned, it labels the lighting effect ids
wrongly, it renders a board the keyboard does not have, and it can only talk
to the keyboard over USB. This project documents the protocol properly and
gives you the parts the vendor app is missing.

**Unofficial.** Not made, endorsed or supported by the hardware manufacturer.

## What is here

| Path | |
|---|---|
| [`evofox/README.md`](evofox/README.md) | the protocol specification, the command set, the payload layouts, the bugs found in the vendor app, and how every claim was checked against real hardware |
| [`evofox/protocol.js`](evofox/protocol.js), [`evofox/ronin.js`](evofox/ronin.js) | the wire format and the Node client |
| [`evofox/ronin.py`](evofox/ronin.py) | the same client in Python, with no dependencies |
| [`evofox/web/`](evofox/web/) | the browser configurator: keymap layers, lighting, per-key colours, macros, profile import/export and four games |
| [`evofox/mcp/`](evofox/mcp/) | an MCP server so an AI agent can read and write the keyboard |
| [`evofox/cli.js`](evofox/cli.js) | `ronin info`, `ronin keymap`, `ronin light`, `ronin colors`, `ronin raw` |
| [`evofox/games.test.mjs`](evofox/games.test.mjs) | tests for the board helpers and the games |

## Quick start

```bash
cd evofox
npm install
npm run web        # http://localhost:5173
```

Click **Connect** in Chrome or Edge for WebHID, or **Use the bridge** to go
through the bundled local bridge, which works in any browser and is what the
automation uses.

The board has to be in USB mode: the firmware only serves its configuration
interface over the cable, not over Bluetooth (see section 14 of
[`evofox/README.md`](evofox/README.md)).

## The games

The **Game** tab plays on the keyboard's own keys: **Snake**, **Lights Out**,
**Memory** and **Reaction**. They use the per-key RGB table, so the keyboard
is the screen — the physical layout, gaps and all.

## Tests

```bash
cd evofox
npm run test:game          # the board helpers and all four games
npm run test:mcp           # the MCP handshake and tool catalogue
npm run test:mcp:live      # reads and writes the attached keyboard
npm run test:mcp:grid      # paints a picture on the board over MCP
```

The live tests need the keyboard attached on USB and put it back the way they
found it.

## License

MIT.
