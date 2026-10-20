# RONIN CONFIG — reverse-engineered configuration protocol for the Ronin keyboard

Unofficial tool. It is not made, endorsed or supported by the hardware
manufacturer; it exists because the vendor's own configurator does not work
correctly on this board.

Everything here was extracted from the vendor web configurator
(<https://evofox.rdmctmzt.com/>, a Next.js app) and then **verified against a live
Ronin TKL** (`USB\VID_320F&PID_5055`).

There is **no HTTP API** for device configuration. The configurator talks to the
keyboard over **WebHID**; the only network calls the app makes are for static
assets (keyboard-layout JSON, i18n strings, firmware binaries). All device
traffic is described below.

## The hosted app

The configurator is also served from this repository:
<https://github.akashrchandran.in/ronin-config/>. The Pages workflow
(`.github/workflows/pages.yml`) assembles `web/` together with the shared
modules it imports from the directory above it, so the published site mirrors
the layout the local server uses.

On the hosted page the **Connect** button talks to the keyboard over WebHID,
which needs Chrome or Edge. The **Bridge** button still reaches a bridge
running on your own machine — the page falls back to `ws://localhost:5173`
once it is not served from that machine's own server.

## Quick start

```bash
npm install
npm run web          # http://localhost:5173
```

Open the page, then pick a transport:

- **Connect** - WebHID, direct from the browser. Chrome and Edge only; the
  browser shows its device picker.
- **Bridge** - talks to `web/serve.js` over a WebSocket instead. Works in
  Firefox and Safari, and is the path the automated tests use.

Close the vendor app first: the keyboard can only be held by one program at a
time. The app reads the board on connect (firmware, four keymap layers, the
light matrix, the three lighting profiles) and shows what it found.

The interface is dark by choice: it is used next to the keyboard, usually in a
dim room, and it has to stay legible while the board is the brightest thing on
the desk. Type is IBM Plex Sans and IBM Plex Mono, self-hosted under
`web/fonts/`, so nothing is fetched at runtime.

---

## 1. Identifying the keyboard

| Property | Value |
|---|---|
| USB VID / PID | `0x320F` / `0x5055` (12815 / 20565) |
| Manufacturer string | `RDR` |
| Product string | `EvoFox Ronin TKL` (also `Ronin TKL Wired`, `Ronin TKL Wireless`, `RGB Keyboard`) |
| Configuration collection | usage page `0xFF1C`, usage `0x0092` |
| HID report ID used by the app | `4` |
| Report payload | 63 bytes after the report id (64-byte buffer in the app) |

The device exposes 7 HID collections; the configurator only uses the vendor
collection `0xFF1C/0x0092` (`MI_01&Col04`). The app filters it with

```js
vendorId === 0x320F ? (usagePage === 0xFF1C && usage === 0x0092)
                     : (usagePage === 0xFF00 && usage === 0x0061)
```

and writes with HID report id `4` (report id `0` for the other vendor family).

> Note: the app also contains a `0xFF55/0x0010` filter (module `23009`) — that is
> dead code for this product; the Ronin path is the `0xFF1C` one.

---

## 2. Frame format

Every frame is a fixed 63-byte payload. The first byte is a *phase* byte, the
second a *command argument*, the third the *command id*, the fourth the
*payload length*, the rest are arguments / payload.

### Request

```
byte 0   phase      0x00 normal · 0x01 start-comm · 0x02 stop-comm
byte 1   arg0       command specific (layer index for keymap commands, else 0)
byte 2   CMD        command id
byte 3   LEN        payload length requested
byte 4.. args       command arguments
```

### Response

```
byte 0   phase echo
byte 1   0x00
byte 2   CMD echo
byte 3   LEN echo
byte 4   0x00
byte 5   0x00
byte 6   STATUS     0x00 = ACK, 0xFF = NAK
byte 7.. payload
```

A NAK is returned when the frame is malformed — e.g. putting the command id one
byte too early (`00 00 00 03 22` → NAK, `00 00 03 22` → ACK). This is how the
command-id position was pinned down experimentally.

**Checksum:** there is none on ordinary frames. Only two write commands carry a
trailing checksum byte (see §6).

Live capture (request → response, report id stripped):

```
>> 00 00 03 22                                  (get device base info)
<< 00 00 03 22 00 00 00 aa 55 00 00 03 80 18 00 02 ... 0f 32 55 50 00 01 ...

>> 00 00 00 03 22                              (same command, id one byte late)
<< 00 00 00 03 22 00 ff 00 00 00 ...           (status byte 0xFF = NAK)
```

---

## 3. Command set (0x320F protocol)

| Cmd | Name | Args | Payload |
|---|---|---|---|
| `0x01` | start comm | – | – |
| `0x02` | stop comm | – | – |
| `0x03` | get device base info | `LEN=34` | 56-byte info block |
| `0x05` | get function info | `LEN=34` | 56-byte settings block |
| `0x06` | set function info | `LEN=56`, 56 bytes | – |
| `0x07` | get **factory** keymap | `arg0=layer`, `LEN`, `offset` | keymap bytes |
| `0x08` | get **user** keymap | `arg0=layer`, `LEN`, `offset` | keymap bytes |
| `0x09` | set user keymap | `LEN`, `offset`, `layer`, 56 bytes | – |
| `0x0A` | get per-key RGB | `LEN`, `offset` (init: `LEN=56`) | 3 bytes/key |
| `0x0B` | set per-key RGB | `LEN`, `offset`, 55 bytes, checksum | – |
| `0x0D` | restore factory settings | – | – |
| `0x15` | set macro list v2 | `LEN`, `offset`, checksum, 56 bytes | – |
| `0x1B` | get lighting matrix | `LEN`, `offset` | 128 bytes |

Multi-byte payloads are transferred in 56-byte chunks with a 16-bit
little-endian offset (`offsetLo`, `offsetHi`).

The vendor app also listens for unsolicited notifications on the same
collection: `0xA0` (calibration), `0xA2` (reset), `0xAA 0xFA` (light event).

---

## 4. Payload layouts

### 4.1 Device base info — cmd `0x03` (56 bytes)

```
off  0   aa 55        magic
off  2   00 00
off  4   03           protocol tag
off  5   80
off  6   18
off  7   00
off  8   02
off  9..20  00        reserved
off 21   0f 32        vendorId  = 0x320F   (LE u16)
off 23   55 50        productId = 0x5055   (LE u16)
off 25   00 01        firmware version 0x0100 -> "1.00"
off 27   00           profile
off 28   00
off 29   01
off 30   02
off 31   03
off 32..55  00
```

`firmwareVer` is confirmed by the vendor app: it converts the number to hex and
compares it with the registry entry `upgradeVersion: "100"` — `0x0100 → "100"`.

### 4.2 Function / lighting settings — cmd `0x05` (56 bytes)

The block lives in flash in **three profiles, 0x40 bytes apart** (`0x00`,
`0x40`, `0x80`). Select one with the offset field of the frame
(`cmd 0x05` / `cmd 0x06`, offset = profile × 0x40), and the first payload byte
carries the profile index.

```
off  0   00           profile index (0..2)
off  1   04           light mode (effect id, 1..21)
off  2   04           brightness (0..4)
off  3   00           speed, stored inverted (hardware value = 4 - speed)
off  4   ff           direction
off  5   00           mix colour (1 = rainbow cycle)
off  6..08  80 00 ff  light RGB (firmware clamps each channel to 0xF7)
off  9   06           stage / rate flag
off 10..12  00 00 00  custom base RGB
off 13..17  00
off 18   01           light group
off 19   00           WASD mode
off 20   ff           6K/NK no-conflict
off 21   00           Win lock
off 22   00           report rate
off 23   00           hit rate
off 24   00           hit delay
off 25..31  00
off 32..34  00 00 00  light colour (B,G,R order in the vendor app)
off 35..55  00
```

Effect ids (measured on this board): 1 Corrugated, 2 Cloud, 3 Serpentine,
4 Spectrum, 5 Breath, 6 Normal, 7 Reaction, 8 Ripples, 9 Traverse, 10 Stars,
11 Flowers, 12 Roll, 13 Wave, 14 Cartoon, 15 Rain, 16 Scan, 17 Surmount,
18 Speed, **19 Custom (per-key RGB)**, **20 Off**, 29 Audio wave, 30 Shadow.

The vendor's layout file for the wired board (`320f_5055_2.json`) lists
**20 = Custom and 21 = Off**, which is wrong for this firmware: 20 switches the
backlight off (verified: the board goes dark) and the per-key RGB mode is 19
(the numbering the vendor uses for the wireless variant, and the same one the
second reverse-engineering project documents). The configurator therefore
shows 19 = Custom and 20 = Off, and switches the board to 19 when per-key
colours are applied.

`setFuncInfo` (`0x06`) writes the same 56 bytes back (always preceded by
start-comm and followed by stop-comm).

### 4.3 Keymap — cmds `0x07` / `0x08`

* 128 slots × 3 bytes = **384 bytes** of key data.
* Slot order on this firmware is the physical key order of the board
  (Esc, F1…F12, Del, Mute, `, 1…0, -, =, Bksp, Ins, Tab, Q…P, [, ], \, PgUp,
  Caps, A…L, ;, ', ISO-\, Enter, PgDn, Shift, ISO-Enter-extra, Z…M, ,, ., /,
  RShift, Up, ←, LCtrl, LWin, LAlt, Space, RAlt, Fn, RShift, …, arrows, numpad,
  …) — slots 120..127 are empty (`00 00 00`).
* The Ronin firmware is **ISO**: slot 57 is usage `0x32` (non-US `\`/`|`) and
  slot 61 is usage `0x64` (non-US backslash), even though the shipped layout
  JSON (`320f_5055_2.json`) is ANSI.
* The vendor app requests 512 bytes but only consumes the first 384. Bytes
  past offset 384 are not keymap data: the device **wraps the read offset**
  (offset 384 returns keymap bytes 0…, offset 392 returns bytes 8…, …).

### 4.4 Per-key colours — cmds `0x0A` / `0x0B`

3 bytes per key (R, G, B), 128 keys = 384 bytes, read in 56-byte chunks.

**Do not arm the read.** The vendor app sends a bare `00 00 0A 38` before the
chunks, and the firmware advances its read pointer by the length of *every*
request. That throwaway read shifts the whole table, so the colours that come
back sit on the wrong keys. Reading the chunks straight away returns the table
byte for byte (measured: a 384-byte write reads back with zero mismatched
bytes, duplicate colours included).

### 4.5 Lighting matrix — cmd `0x1B`

128 bytes, one per key: the assigned light-effect index, `0xFF` = not set.
Observed on a factory board: `00 01 02 … 37` for the first 56 keys, `0xFF`
gaps elsewhere.

### 4.6 Macros — cmd `0x15` (write only)

The app builds a 1096-byte macro block:

```
off 0   aa 55        magic
off 2   lenLo lenHi  total macro payload length
off 4   cntLo cntHi  number of macros
off 6   00 00
off 16  per-macro directory: 2-byte offset + 2-byte length each
then   per-macro entries: 4 bytes each = {timeLo, timeHi, actionByte, keyCode}
        actionByte 0x0A = key press, 0x8A = key release
        action 1 = keyboard (4th byte = HID usage),
        action 3 = mouse    (4th byte = button bitmask: 1 L, 2 R, 4 M, 8 Fwd, 16 Back)
```

A step in the app is one action the user thinks of as one: tapping a key is
a single step and expands into a press and a release on the wire. `mode`
picks the other shapes, `hold` presses without releasing and `release`
releases without pressing. (Older recordings stored the press and the release
as two steps, which made one key press show up twice; they are folded back
into one step when the browser loads them.)

The block is sent in 56-byte chunks; each chunk carries a checksum byte
computed over the chunk payload.

---

## 5. Keymap entry encoding

A key is `(type, code1, code2)`:

| type | meaning | code1 | code2 |
|---|---|---|---|
| `16` | mouse button / wheel | button bitmask (1 L, 2 R, 4 M, 8 Fwd, 16 Back) | 1 = wheel |
| `18` | modifier + HID usage | modifier mask | HID usage |
| `32` | modifier + HID usage (primary) | modifier mask | HID usage |
| `48` | consumer / media key | consumer usage | sub-code |
| `64` | power management | 1 Power, 2 Sleep, 4 Wake | 0 |
| `80` | vendor icon key | 1..7 | 0 |
| `31` / `160` | Fn | 1 | 1 / 0 |
| `112` | macro (single replay) | macro index | macro type |
| `113` | macro (multi replay) | macro index | replay count |
| `0` | empty slot | 0 | 0 |

Modifier mask (bit → modifier → HID code):

```
0x01 CTRL  224    0x10 RCTRL 228
0x02 SHIFT 225    0x20 RSHIFT 229
0x04 ALT   226    0x40 RALT  230
0x08 WIN   227    0x80 RWIN  231
```

A lone modifier is stored as `code1 = <one bit>, code2 = 0`; a combination is
`code1 = <OR of bits>, code2 = <usage of the non-modifier key>`.

Media keys (`type 48`) resolve through this table (usage, sub-code → name):
`131/0 Play`, `131/1 Multimedia`, `181 Next Track`, `182 Prev Track`,
`183 Stop`, `205 Play/Pause`, `207 Siri`, `226 Mute`, `233 Vol+`, `234 Vol-`,
`111 Bright+`, `112 Bright-`, `35/2 Homepage`, `36/2 Web Backward`,
`37/2 Web Forward`, `38/2 Web Stop`, `39/2 Web Refresh`, `42/2 Web Favorites`,
`33/2 Web Search`, `146/1 Calculator`, `148/1 My Computer`, `138/1 Mail`,
`160 Launchpad`, `175 Select`, `176 Eject`, `188 Rewind`, `187 Fast Forward`.

`keymap.js` in this repo implements the decoder.

---

## 6. Write paths and checksums

| Command | Frame |
|---|---|
| `0x06` set function info | `00 00 06 38 00 00 00` + 56 payload bytes |
| `0x09` set keymap | `00 00 09 len offLo offHi layer` + 56 payload bytes (no checksum) |
| `0x0B` set colours | `00 00 0B 38 offLo offHi 00` + 55 payload bytes + checksum |
| `0x15` set macros | `00 00 15 len offLo offHi checksum` + 56 payload bytes |

* Colour checksum = sum of **all** frame bytes (request header included) mod 256,
  appended as the last byte.
* Macro checksum = sum of the 56-byte chunk payload mod 256, placed in the
  header at byte 5 (the `checksum` field above).

The vendor app wraps keymap / colour / macro writes in
`start comm → write… → stop comm`.

---

## 7. The web app's own API surface

| Request | Where it comes from |
|---|---|
| `GET /` | Next.js shell (the configurator SPA) |
| `GET /_next/static/chunks/*.js` | app bundle, all device logic lives here |
| `GET /_next/static/css/*.css` | styles |
| layout JSON `./<layout>.json` | webpack require-context; e.g. `320f_5055_2` → inlined in chunk `168.20df1abfb27a8894.js`, `320f_5055_3` → chunk `453.6d1d9d2e1635746f.js` |
| i18n JSON `./<lang>/<ns>.json` | webpack require-context, e.g. `en/common.json` |

Device → layout mapping is a static table in the bundle:

| key | layout | upgradeVersion |
|---|---|---|
| `0x320F_0x5055_0_EvoFox Ronin TKL` | `320f_5055_2` | `100` |
| `0x320F_0x5055_0_Ronin TKL Wired` | `320f_5055_2` | `100` |
| `0x320F_0x5055_0_Ronin TKL Wireless` | `320f_5055_3` | `100` |
| `0x320F_0x5055_0_RGB Keyboard` | `320f_5055_3` | `100` |
| `0x36B0_0x3060_0_EvoFox Ronin TKL` | `36B0_3060_0` | `100` |

The key is built as `0x<VID>_0x<PID>_<keyboardID>_<productName>`.

**localStorage keys used by the app:** `keyboardMode` (0/1/2 – which icon-key
table to use), `macro_profile_<version>`, `macro_profile_index_<version>`,
`local_profiles`.

### Firmware update

The app **never flashes firmware over HID**. The "Firmware Update" panel only
builds a download link:

```js
let a = document.createElement("a");
a.href = deviceUpgradeFile; a.download = deviceUpgradeFile.split("/").pop();
a.click();
```

and then tells the user to run the vendor's separate flashing tool
("Open the downloaded firmware tool" → "Read device info, display OK" →
"ToBoot" → "Start"). The URL comes from the registry entry's `updateFile`
field — and **none of the shipped Ronin entries have one**, so for
`0x320F:0x5055` the download link is empty and the panel is inert. The only
version information the app has is the static `upgradeVersion: "100"` per
device entry, compared against the firmware version it reads from the device
(which, see the bug below, it never actually gets).

---

## 8. Physical layout and lighting effects

The layout JSONs shipped with the app were extracted to `layout/`:

* `layout/320f_5055_2.json` – Ronin wired / TKL wired
* `layout/320f_5055_3.json` – Ronin wireless / RGB keyboard

Each contains 79 physical keys (`row`, `col`, `x`, `y`, `w`, `h`, `code`,
`index`, `name`, `mode`) on a 6 × 21 matrix, plus the lighting effect list.
The lighting list is the value domain of `lightMode` in the function-info
block:

```
1 Corrugated   2 Cloud      3 Serpentine  4 Spectrum    5 Breath
6 Normal       7 Reaction   8 Ripples     9 Traverse   10 Stars
11 Flowers    12 Roll      13 Wave       14 Cartoon   15 Rain
16 Scan       17 Surmount  18 Speed      20 Custom    21 Off
```

The board was running effect 17 (`Surmount`) during this analysis.

---

## 9. Bugs found in the vendor app (0x320F path)

1. **Base info is never parsed.** `getDeviceBaseInfo()` validates the reply
   with `t[3] === 3`, but the command id is echoed at byte **2** (byte 3 is the
   length). The check therefore always fails and the method returns `{}` — the
   app never sees the firmware version or keyboard id. The sibling method
   `getFuncInfo()` checks `e[2] === 5` and works, which confirms the off-by-one.
2. **Factory layout is ANSI, firmware is ISO** — the layout JSON shipped for
   `320f_5055_2` has a 2.25u Enter and no ISO key, while the board's factory
   keymap contains the two extra ISO usages (`0x32`, `0x64`).
3. The layout JSON's own `index` fields are inconsistent (e.g. `PgUp` and
   `PgDn` both carry `index: 56`); the app overwrites them anyway.
4. `Ck()` (key name decoder) has no branch for `type 80` icon keys on the
   0x320F path, so those keys render with an empty name.
5. The shipped UI chunk calls `getAllKeyColor()` and `setTravelKeys()` on the
   connected keyboard, but those methods only exist on the *other* vendor's
   client class. On a Ronin those panels throw.
6. The layout file the app picks for this board (`320f_5055_2.json`) is a
   79-key ANSI TKL, while the keyboard's own keymap has 120 assigned slots
   covering a JIS full size with a numpad. The app therefore renders the
   wrong board and leaves 48 slots unreachable.
7. That layout file also mislabels the last two lighting effects: it says
   20 = Custom and 21 = Off, but on this firmware 20 = Off and the per-key
   RGB mode is 19. Combined with the broken colour write (55-byte stride
   instead of 56), the vendor app cannot show per-key colours on this board.

---

## 10. Web configurator (`web/`)

A replacement for the vendor app, built on the protocol above. It talks to the
keyboard over **WebHID** in Chrome/Edge, or through the bundled **local
bridge** (useful for Firefox/Safari and for automation).

```bash
npm install
npm run web            # http://localhost:5173
```

`localhost` is a secure context, which WebHID requires. Click **Connect** for
WebHID, or **Bridge** to go through `web/serve.js`, which proxies frames to
the keyboard over a WebSocket on the same port.

What it does that the vendor app does not:

| | vendor app | this app |
|---|---|---|
| firmware version | never parsed (off-by-one bug) | shown, `0x0100` on this board |
| board rendering | renders the wrong board: a generic ANSI TKL shape with a numpad this keyboard does not have | the physical board from the vendor layout file: 79 keys on a 19.56 x 6.5 unit grid, the compact 75% with the knob column |
| hidden slots | 48 slots unreachable | every slot is assignable, extras listed |
| layers | reads layer 0 only | all four layers, switchable, per-layer dirty state |
| remapped keys | no indication | keys that differ from factory are flagged |
| colours | vendor-only presets | per-key picker with presets, arbitrary RGB, addressed through the light matrix, switches the board to custom mode |
| lighting profiles | one live setting | all three onboard profiles (flash slots `0x00/0x40/0x80`) |
| speed / brightness | raw registers | true 0-4 speed (the firmware stores it inverted) and 0-4 brightness, RGB clamped to 0xF7 |
| macros | browser storage only | browser storage **and** a real push to the keyboard (cmd `0x15`), loop types, and a key recorder |
| advanced keys | not offered on the Ronin path | the full vendor "advanced" key set (Fn/To layers, light controls, 2.4G/USB/BLE modes, battery, reset, test mode) |
| performance | hidden | report rate, hit rate, hit delay, 6K/NK no-conflict, Win lock, WASD mode |
| effects | 20 from the layout file | 22 (the layout file omits *Audio wave* and *Shadow*, which the firmware supports) |
| direction | 3 options | the vendor's 8 directions |
| backups | none | profile export/import as JSON (layers, lighting, colours, macros) |
| raw access | none | protocol console with hex frames |
| undo | none | undo/redo of every edit (Ctrl+Z) |

Everything is staged locally first: edits land in a working copy and only
reach the keyboard when you press **Apply**.

### Pictures on the keyboard

The **Per-key colours** card takes an image and maps it onto the board. The
keyboard's physical grid is the canvas: the picture is scaled to the board's
19.56 x 6.5 key units and every key samples the pixel at its own position,
so the image lands on the keys in their real places rather than in a grid
that ignores the layout. Keys the firmware gives no colour slot (the block
above the arrow cluster, some of the function row) stay dark.

**Fit** keeps the picture's proportions and centres it, **Fill** stretches it
to the whole board. The result is previewed on the board in the app and
reaches the keyboard with **Apply colours**, which also switches the board
to the per-key mode (19) because the table is only visible there. Colours
are clamped to `0xF7` the same way the firmware clamps them.

Keys the firmware gives no colour slot stay dark: the light matrix has no
entry for them, so there is nothing to write. On this board that is the
bottom row (Ctrl, Win, Alt, Space, the arrows) and a few others.

The same mapping is available to the MCP server as a text grid, so a model
can paint a picture without an image file: `ronin_colours_write` takes
`grid`, an array of rows of hex colours, and maps it onto the board the same
way (`art.js` holds the sampling for both).

### Games

The **Game** tab plays on the keyboard itself. Four games, picked from the
row of buttons: **Snake**, **Lights Out**, **Memory** and **Reaction**.

They all play on the board's own keys rather than an idealised grid, so they
follow the real layout, gaps and all: a key's neighbours are the keys
physically next to it, and up or down means the closest key in the row above
or below. 83 of the board's keys have a colour slot and can be lit, so those
are the field; the handful the firmware gives no slot for cannot be shown at
all.

Every tick writes the per-key colour table: whatever the game lit, everything
else is dark. The board has to run the per-key mode for any of it to show, so
a game switches it and puts the previous effect back when it stops.

| Game | Rules |
|---|---|
| **Snake** | The classic. Arrow keys or WASD steer it, the head is white, the body red, the food green. The speed slider goes from 70 ms to 600 ms a step. |
| **Lights Out** | Pressing a key toggles it and its neighbours; the goal is to get every light out. The puzzle is built by pressing keys on an empty board, so it is always solvable. The board's own shape is the puzzle. |
| **Memory** | Simon. The board flashes a sequence and you repeat it; the sequence grows by one every round. |
| **Reaction** | A key lights after a random delay and you have to hit it. Pressing early or hitting the wrong key is a miss; the best and average times are shown. |

The rules live in `web/games/` without any DOM, so they can be tested on
their own: `node games.test.mjs` covers the field, the neighbours and all
four games.

Layout files:

* `layout/320f_5055_2.json` – the vendor's layout file: the physical board
  (79 keys, 19.56 x 6.5 units) and the lighting effect list. The app renders
  the board from this file and takes the keymap slots from the keyboard
  itself, so the picture on the keys is the picture the user sees.
* `layout/ronin-device.json` – a layout derived from the board's own factory
  keymap. It follows the firmware's generic keymap, which covers more keys
  than the board has (numpad included), so it is kept as evidence rather
  than used for rendering (regenerate with `node tools/build-layout.mjs`)

---

## 11. Using the client

Two implementations are included; both were run against the connected board and
return identical data.

### Node.js (`ronin.js`)

```bash
npm install
node cli.js info                       # device id, firmware, lighting settings
node cli.js keymap --layer 0           # decoded user keymap
node cli.js keymap --default           # factory keymap
node cli.js light                      # per-key lighting matrix
node cli.js colors                     # per-key RGB
node cli.js raw 0x03 22                # raw frame (cmd, len, args…)
```

```js
const { Ronin } = require('./ronin');
const kb = new Ronin().open();
await kb.startComm();
const km = await kb.getKeymap(0);          // {bytes, keys:[{index,type,code1,code2}]}
await kb.stopComm();
```

### Python (`ronin.py`, no dependencies)

Uses `ctypes` against `setupapi.dll` / `hid.dll` with **overlapped I/O**
(a pending synchronous read blocks writes on a HID handle, so both directions
must be asynchronous).

```bash
python ronin.py
```

```python
from ronin import Ronin
with Ronin() as kb:
    kb.start_comm()
    print(kb.get_device_base_info())
    print(kb.get_keymap(0)["keys"][:3])
    print(kb.get_light_matrix())
    kb.stop_comm()
```

`node verify.js` runs a full read-only round trip against the connected board.

**What was verified live on a real Ronin TKL (firmware `1.00`):**

| Path | Result |
|---|---|
| read base info (`0x03`) | ACK, vendor `0x320F` / product `0x5055`, firmware `0x0100` |
| read function info (`0x05`) | ACK, effect 17, brightness 4, RGB 128/0/255 |
| read user + factory keymap (`0x08`/`0x07`) | ACK, 128 slots, identical user/factory map |
| read light matrix (`0x1B`) | ACK, 128 bytes |
| read per-key colours (`0x0A`) | ACK |
| **write keymap** (`0x09`, 7 × 56-byte chunks) | write-back of the factory map → re-read identical |
| **write function info** (`0x06`) | write-back of the same 56 bytes → re-read identical |
| malformed frame (command id one byte early) | NAK (`0xFF` at byte 6) |

Not exercised against hardware (write paths taken from the vendor app, no
safe test available): per-key colour write (`0x0B`), macro write (`0x15`),
factory reset (`0x0D`).

---

## 12. Cross-checks with other reverse engineers

Two independent projects reverse engineered the same keyboard. Both agree with
the analysis above on the parts that matter, and both corrected details here.

**[arctan2/evofox_ronin_rgb](https://github.com/arctan2/evofox_ronin_rgb)** (Python, `hid`)

* Confirms report id 4, 63-byte frames, and the `0x01` begin / `0x0B` colour /
  `0x02` commit handshake.
* Its colour packet header matches byte for byte: `[0, 0, 11, 56, off_lo,
  off_hi, 0, <data>, checksum]`, data starting at byte 7.
* It captures the func-info write as a mode packet with `mode` at byte 8 and
  `brightness` at byte 9, which is exactly the struct in §4.2.
* It documents `mode 20` = "custom per-key RGB" and `21` = off.
* Its `KEY_TO_IDX` map shows the **LED** order of a 65 % board (a column-major
  grid), which is not the keymap slot order. Per-key colours are addressed
  through the light matrix, not through the slot number (see below).

**[sumitraj-saroj/evofox-ronin](https://github.com/sumitraj-saroj/evofox-ronin)** (Linux driver, PyQt6 app)

* Documents the controller: Evision VS11K09A, wired `0x320F:0x5055`, the
  2.4 GHz dongle is a different device (`0x3554:0xFC03`) and must not be
  claimed, so the volume knob keeps working.
* Same three-step handshake: begin `0x01` → write `0x06` → commit `0x02`, with
  ~10 ms between the steps.
* Same 21-byte lighting payload, including **brightness 0-4**, **speed stored
  inverted** (`hw_speed = 4 - speed`), **rainbow flag** and **RGB clamped to
  0xF7**.
* Documents the **three onboard lighting profiles** at flash offsets `0x00`,
  `0x40`, `0x80` - confirmed live against this board.

Two disagreements, resolved by measurement here:

1. **Colour packet stride.** The vendor app and the first project send 55 RGB
   bytes plus a checksum byte, stepping the offset by 55. Measured against the
   board, the firmware copies the declared `LEN` bytes verbatim, so that
   variant stores a shifted image with a stray checksum byte in it (read-back
   mismatch). This implementation sends 56 bytes with no checksum, and the
   read-back matches exactly.
2. **Bytes 0 and 1 of a frame.** The vendor app uses them as a phase byte
   (1 = begin, 2 = commit); the second project writes a 16-bit checksum
   there. The firmware accepts either - it never rejects a frame because of
   them - so the checksum is optional. This implementation uses the phase
   byte, which is what the vendor app does and what the commit handshake
   expects.

### Per-key colour addressing

The colour table is not indexed by keymap slot. The light matrix
(cmd `0x1B`) maps each slot to its colour index: on this board slots 0-89 are
the identity, slot 14 has none, slots 90-111 have none and slots 112-127 point
at shared indices. The app therefore paints `colour[lightMatrix[slot]]` and
refuses keys that have no colour slot. Per-key colours are only visible while
the board runs the **custom mode (20)**, so the app switches to it when the
colours are applied.

Two firmware quirks were measured on the board:

* The first bytes of the table are firmware owned: writing bytes 0-7 of the
  table is discarded (they read back as 0), so the first keys of the table
  cannot be set through this path.
* A colour write is only accepted at offset 0. Writing with the vendor's
  55-byte stride or with a non-zero offset leaves the table untouched, which
  is why the vendor's own per-key colours land on the wrong keys.

The app writes the table in 56-byte packets at offset 0, which is the only
form that round-trips byte for byte.

---

## 13. MCP server (`mcp/`)

The same protocol, exposed to an AI agent over MCP, so the keyboard can be
configured by asking for it instead of by hand.

```bash
npm run mcp        # JSON-RPC over stdio, the way MCP clients expect
```

Point an MCP client at `evofox/mcp/server.js`:

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

Eleven tools: `ronin_status`, `ronin_effects`, `ronin_keymap_read`,
`ronin_keymap_write`, `ronin_lighting_read`, `ronin_lighting_write`,
`ronin_colours_read`, `ronin_colours_write`, `ronin_light_matrix_read`,
`ronin_macros_write` and `ronin_restore_factory`. Keys are named the way the
keyboard names them ("F5", "Space", "Ctrl+Shift+A", "Mouse 4"), and every write
is read back so the model sees what the board really holds.

Only one program can hold the keyboard, so the server uses the local bridge
when it is running and the USB HID device otherwise (`RONIN_TRANSPORT`:
`auto`, `bridge`, `hid`). See `mcp/README.md` for the full setup and the tool
reference.

## 14. Bluetooth

**Settings cannot be sent over Bluetooth.** The configuration interface is a
USB HID collection and the firmware only serves it on the cable.

Measured on the keyboard (BLE identity `EvoFox Ronin TKL-1`, paired and
connected):

| Transport | What the board exposes |
|---|---|
| USB, wired mode | standard keyboard/consumer collections **+ the vendor configuration collection** (`0xFF1C`/`0x0092`, report id 4, 63-byte payload) |
| USB, Bluetooth mode | standard collections + a **read-only** vendor collection (`0xFF01`/`0x0001`); every output report id is rejected, so the configuration collection is simply gone |
| BLE (GATT) | HID service `0x1812` (the standard keyboard, and Windows keeps it to itself: `AccessDenied`), battery service `0x180F` (76% at the time), device info, and a vendor service `00010203-…` with a **1-byte** writable/readable control (the transport mode) and a 12-byte descriptor |

The vendor's own app is a WebHID app, which is USB only, so it could never
have done Bluetooth either: the limitation is the firmware's, not the app's.

What does work: configure the board once over the cable and keep using it
over Bluetooth. The keymap layers and the three lighting profiles live in
flash, so they survive the switch to wireless. The per-key colour table is
part of the custom lighting mode and is pushed with the lighting write.

To configure the board it has to be in USB mode; in Bluetooth mode the
`0xFF1C` collection is not enumerated and the clients report the board as
missing. `tools/ble-probe.py` dumps the GATT tree of a paired keyboard:

```bash
pip install winrt-Windows.Devices.Bluetooth winrt-Windows.Storage.Streams
python tools/ble-probe.py --address D1:00:D1:12:A4:FD
```

The address of a paired keyboard is in its device properties
(`Get-PnpDevice … -KeyName DEVPKEY_Bluetooth_DeviceAddress`).

## 15. Files

| File | Purpose |
|---|---|
| `protocol.js` | shared wire format: frames, parsers, macro builder |
| `keys.js` | shared key catalogue, modifier bits, keymap decoder |
| `effects.js` | the lighting effect list, corrected for this firmware |
| `art.js` | picture to per-key colour sampling, shared by the app and the MCP server |
| `ronin.js` | Node client (node-hid) |
| `ronin.py` | Python client (ctypes, no dependencies) |
| `cli.js` | command line front end for the Node client |
| `verify.js` | live read-only round trip (`--write` also exercises the write paths) |
| `web/index.html`, `web/styles.css` | the configurator shell and its design system |
| `web/app.js` | configurator controller (state, editing, apply) |
| `web/transport.js` | WebHID transport and local-bridge transport |
| `web/keyboard.js` | board model and renderer |
| `web/serve.js` | static server + WebSocket bridge to the keyboard |
| `web/games/board.js` | the board as the games see it: field, rows and neighbours |
| `web/games/snake.js` | snake |
| `web/games/lights-out.js` | lights out |
| `web/games/memory.js` | memory (Simon) |
| `web/games/reaction.js` | reaction trainer |
| `games.test.mjs` | tests for the board helpers and all four games |
| `tools/build-layout.mjs` | regenerates `layout/ronin-device.json` |
| `tools/ble-probe.py` | dumps the Bluetooth GATT tree of the keyboard |
| `mcp/server.js` | MCP server: JSON-RPC over stdio |
| `mcp/tools.js` | the MCP tool catalogue |
| `mcp/session.js` | device session, key resolution, transport choice |
| `mcp/smoke.test.mjs` | MCP handshake and tool list test (no keyboard needed) |
| `mcp/live.test.mjs` | live read/write/restore test against the keyboard |
| `mcp/grid.test.mjs` | live test of the picture grid through the MCP server |
| `layout/*.json` | keyboard layouts and lighting effect tables |
| `js/` | the downloaded configurator bundle (evidence base) — kept local, not redistributed |

