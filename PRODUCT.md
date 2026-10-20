# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

People who own a Ronin mechanical keyboard (USB `0x320F:0x5055`) and want to
configure it themselves: remap keys, build macros, set lighting and per-key
colours. They arrive because the board's own configurator does not work
correctly on this hardware.

The tool is meant to be shared with other owners of the same board, so it has
to be installable, explainable and recoverable by someone who has never seen
it: no vendor account, no cloud, no driver.

## Product Purpose

A browser configurator that talks to the keyboard directly over its HID
protocol. It reads the board's real state (firmware version, keymap layers,
lighting profiles, light matrix, per-key colours), lets the owner change any
of it, and writes the changes back.

Success means the owner sees the change on the hardware in front of them, and
can get back to a known state afterwards.

## Positioning

The vendor's own configurator for this board has blocking defects: its
per-key colour write is misaligned, it labels the lighting effect ids wrongly
(so its "custom" entry switches the backlight off instead of enabling
per-key RGB), it renders a layout for a different keyboard than the one
plugged in, and it never shows the firmware version.

This app derives the board's physical layout from the keyboard's own keymap
instead of a shipped file, speaks the vendor HID collection directly, and
keeps every write staged and reversible.

## Operating Context

- Runs locally: `npm run web` serves the app on `http://localhost:5173`.
  A secure context is required for WebHID, which `localhost` satisfies.
- Two transports, both first-class:
  - **WebHID** - Chrome and Edge, direct from the page, with the browser's
    device picker.
  - **Local bridge** - a WebSocket from the page to `web/serve.js`, which
    holds the HID handle. This is the path for Firefox and Safari, and the
    path that lets the app be driven automatically.
- The keyboard can be held by only one program at a time. The vendor app must
  be closed before this one connects.
- The work happens in the same session as the board: paint a key, apply, look
  up. The owner is looking at the hardware, not at a page.
- The app is a static site: vanilla ES modules, no framework, no build step.
  The only runtime dependency is `node-hid` in the bridge process.

## Capabilities and Constraints

Confirmed functionality:

- Four keymap layers of 128 slots, read and written over HID
  (commands `0x07` / `0x08` / `0x09`), with the factory map kept for diffing.
- Key assignment: basic keys, modifier combinations, media keys, mouse
  buttons, power keys, the 73 vendor "advanced" keys, and macros.
- Lighting: 22 effects, brightness 0-4, speed 0-4 (the firmware stores speed
  inverted), RGB clamped to `0xF7`, three onboard profiles in flash, and
  per-key RGB addressed through the board's light matrix.
- Macros: steps of key, mouse or delay, replay count, loop type, pushed to
  the board with command `0x15`.
- Board readouts: firmware version, protocol tag, keymap, light matrix,
  profile contents.
- Local bridge, protocol console, and profile export/import as JSON.

Hard constraints and firmware limits, all measured on the board:

- WebHID exists only in Chrome and Edge and needs a user gesture; every other
  browser needs the local bridge.
- The first bytes of the per-key colour table are firmware-owned, so the
  Esc/F1/F2 region cannot be coloured.
- A colour write is only accepted at offset 0 in 56-byte packets; the
  vendor's 55-byte form is discarded by the firmware.
- The board exposes no travel/actuation command, so key travel cannot be
  written (the vendor app's travel panel is dead code on this board).
- The device has no macro-read command: the macro list lives in the browser
  and is pushed, never read back.
- Lighting profile contents and the live effect are separate: writing a
  profile does not change what the board is currently showing.
- Settings cannot be sent over Bluetooth. The configuration collection is a
  USB HID feature: in Bluetooth mode the firmware does not expose it over USB
  either, and over GATT the board offers only the standard HID service, a
  battery service and a one-byte vendor control. The keymap layers and the
  lighting profiles live in flash, so a board configured over the cable keeps
  its settings when it switches to wireless.

## Brand Commitments

- The app names itself generically. The hardware vendor's name and logo are
  not used in the app's chrome; "Ronin" is used as the model name only.
- The red accent is a design choice for this product, not vendor branding.
- Type is IBM Plex Sans and IBM Plex Mono, self-hosted under
  `evofox/web/fonts/` (SIL Open Font License 1.1). The interface must render
  identically offline and on a machine that has never seen a web font.
- The tool is unofficial. It must not imply vendor endorsement, must not
  reproduce vendor assets, and must say plainly that it is not supported by
  the manufacturer.

## Evidence on Hand

- `evofox/README.md` - the reverse-engineered protocol specification, every
  claim in it checked against real hardware.
- `evofox/protocol.js`, `evofox/keys.js` - the shared protocol and key
  catalogue, used by the browser app, the bridge and the CLI alike.
- `evofox/ronin.js`, `evofox/ronin.py` - Node and Python clients for the same
  protocol.
- `evofox/js/` - the vendor configurator bundle, kept as the evidence base
  for the protocol claims.
- `evofox/layout/` - layout files extracted from the vendor bundle, plus a
  board-derived layout generated by `evofox/tools/build-layout.mjs`.
- Two independent third-party reverse engineerings of the same keyboard, used
  as cross-checks: `github.com/arctan2/evofox_ronin_rgb` and
  `github.com/sumitraj-saroj/evofox-ronin`.

Absences that future work must not fill in: there is no vendor documentation,
no firmware source, no hardware photography, no testimonials, no usage
statistics and no compatibility matrix beyond what was measured on one board
of one revision.

## Product Principles

1. The board is the source of truth. Layouts, effect ids and feature
   availability come from the keyboard, never from a shipped assumption.
2. Nothing is written before the owner can see it. Every change is staged,
   diffed against the factory state, and applied deliberately.
3. The protocol lives in one place. The page, the bridge and the CLI speak it
   through the same module.
4. Assume the vendor app is wrong; verify against the hardware.
5. Another owner must be able to run this. Documented, bridge-supported, no
   account, no cloud, no driver.

## Accessibility & Inclusion

No product-specific requirement was set by the owner. The working standard
for this app is WCAG AA contrast, complete keyboard operation of every
control, and no dependence on colour alone to convey state.
