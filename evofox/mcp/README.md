# Ronin keyboard over MCP

An MCP server for the EvoFox Ronin (USB `0x320F:0x5055`). Point an MCP client
at it and the model can read and write the keyboard: keymap layers, lighting
profiles, per-key colours and macros. The user never has to open the vendor
app or this project's web configurator.

## Install it in an MCP client

The server is plain Node with no build step. `npm install` in this folder
installs `node-hid`, which is the only thing it needs.

```json
{
  "mcpServers": {
    "ronin-keyboard": {
      "command": "node",
      "args": ["C:/path/to/evofox/mcp/server.js"]
    }
  }
}
```

That block goes in the client's MCP configuration (Claude Desktop:
`claude_desktop_config.json`; Claude Code: `claude mcp add`; Cursor, Windsurf
and VS Code: the `mcp.json` next to the project). The path is absolute and
must point at `evofox/mcp/server.js`.

## How it reaches the keyboard

Only one program can hold the keyboard at a time.

- **auto** (default): use the local bridge when it is running, otherwise talk
  to the USB HID device directly. The bridge is `npm run web`; when it is up
  the AI and the web configurator share one keyboard.
- **bridge**: always go through the local bridge.
- **hid**: always talk to the device directly.

Set it with the `RONIN_TRANSPORT` environment variable:

```json
{
  "mcpServers": {
    "ronin-keyboard": {
      "command": "node",
      "args": ["C:/path/to/evofox/mcp/server.js"],
      "env": { "RONIN_TRANSPORT": "bridge" }
    }
  }
}
```

`RONIN_BRIDGE` overrides the bridge address (default
`ws://127.0.0.1:5173/bridge`).

## The tools

| Tool | What it does |
| --- | --- |
| `ronin_status` | Device, firmware, active profile, current lighting, how the server is connected |
| `ronin_effects` | The lighting effects with their ids, plus directions, groups and report rates |
| `ronin_keymap_read` | One keymap layer (0-3) with the physical name of every key |
| `ronin_keymap_write` | Assign keys on a layer, by physical name ("F5") or slot number |
| `ronin_lighting_read` | The lighting settings of one of the three profiles |
| `ronin_lighting_write` | Change effect, brightness, speed, direction, colour and the switch settings |
| `ronin_colours_read` | The per-key colour table |
| `ronin_colours_write` | Paint keys, or paint the whole board one colour |
| `ronin_light_matrix_read` | Which colour index each key uses |
| `ronin_macros_write` | Write the macro list |
| `ronin_restore_factory` | Factory reset, needs `confirm: true` |

Key names are the ones the keyboard itself reports: `A`, `F1`, `Esc`, `Space`,
`Num 5`, plus `Ctrl+Shift+A` style combinations, `Mouse 4`, `Fn 3`, `Unassigned`
and every media, power and advanced key.

Macro steps are one action each: `{ kind: "key", code: 4, time: 30 }` taps a
key (4 is the HID usage for A), `mode: "hold"` presses without releasing and
`mode: "release"` releases without pressing. A tap becomes a press and a
release on the keyboard.

### Pictures

`ronin_colours_write` takes a `grid`: rows of hex colours separated by
spaces, mapped onto the physical board the same way the app maps an image.

```json
{
  "grid": [
    "ff0000 000000 000000 ff0000",
    "000000 ff0000 ff0000 000000"
  ]
}
```

Each cell covers one part of the board, so a grid of 6 columns paints the
left, middle and right thirds of the keyboard. Cells the grid does not
cover are black.

Every write is read back and the result says whether the keyboard really
holds what was asked for.

## Tests

```bash
npm run test:mcp         # handshake, tool list, error handling (no keyboard needed)
npm run test:mcp:live    # reads and writes the attached keyboard, then puts it back
```

The live test changes one key and one colour, checks both, and restores them.
