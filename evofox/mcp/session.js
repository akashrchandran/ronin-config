/**
 * Device session for the MCP server.
 *
 * The keyboard is reached either straight over HID (node-hid) or through the
 * local bridge that the web configurator uses. Only one program can hold the
 * keyboard at a time, so the bridge wins when it is running: the AI and the
 * web app then share one device instead of fighting over it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Ronin } from '../ronin.js';
import { BridgeTransport } from '../web/transport.js';
import * as P from '../protocol.js';
import {
  ADVANCED_KEYS,
  HID_NAMES,
  KEY_TYPES,
  MEDIA_KEYS,
  MODIFIER_BITS,
  MOUSE_BUTTONS,
  POWER_KEYS,
  decodeKey,
} from '../keys.js';
import { buildBoard } from '../web/keyboard.js';
import { lightingEffects } from '../effects.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

export const BRIDGE_URL = process.env.RONIN_BRIDGE || 'ws://127.0.0.1:5173/bridge';

/** Direction values the firmware understands. */
export const DIRECTIONS = [
  { value: 0, name: 'Right to Left' },
  { value: 1, name: 'Left to Right' },
  { value: 2, name: 'Outer Inward' },
  { value: 3, name: 'Inner Outward' },
  { value: 4, name: 'Top to Bottom' },
  { value: 5, name: 'Bottom to Top' },
  { value: 6, name: 'Clockwise' },
  { value: 7, name: 'Anticlockwise' },
  { value: 255, name: 'Off / unset' },
];

/** USB polling rate the board can report at. */
export const REPORT_RATES = [
  { value: 0, name: '125 Hz' },
  { value: 1, name: '250 Hz' },
  { value: 2, name: '500 Hz' },
  { value: 3, name: '1000 Hz' },
];

/** The lighting groups the firmware keeps. */
export const LIGHT_GROUPS = ['Group 0', 'Group 1', 'Group 2', 'Group 3'];

const USAGE_BY_NAME = new Map();
for (const [usage, name] of Object.entries(HID_NAMES)) {
  if (!name) continue;
  if (!USAGE_BY_NAME.has(name)) USAGE_BY_NAME.set(name, Number(usage));
}

/** Spellings people use that the catalogue does not carry. */
const ALIASES = {
  escape: 'Esc',
  return: 'Enter',
  control: 'LCtrl',
  'ctrl ': 'LCtrl',
  spacebar: 'Space',
  'caps lock': 'Caps',
  'page up': 'Page Up',
  'page down': 'Page Down',
  'del': 'Delete',
  'ins': 'Insert',
  minus: '-',
  equal: '=',
  plus: '=',
  'bracket left': '[',
  'bracket right': ']',
  backslash: '\\',
  semicolon: ';',
  quote: "'",
  backquote: '`',
  comma: ',',
  period: '.',
  slash: '/',
  'windows': 'LWin',
  meta: 'LWin',
  cmd: 'LWin',
  command: 'LWin',
  arrowup: 'Up',
  arrowdown: 'Down',
  arrowleft: 'Left',
  arrowright: 'Right',
};

export function hexColour(r, g, b) {
  const part = v => Math.max(0, Math.min(255, v | 0)).toString(16).padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`;
}

export function parseColour(text) {
  if (text && typeof text === 'object') {
    const { r = 0, g = 0, b = 0 } = text;
    return { r: r & 0xff, g: g & 0xff, b: b & 0xff };
  }
  const match = /^#?([0-9a-f]{6})$/i.exec(String(text ?? '').trim());
  if (!match) throw new Error(`Not a #rrggbb colour: "${text}"`);
  const value = parseInt(match[1], 16);
  return { r: (value >> 16) & 0xff, g: (value >> 8) & 0xff, b: value & 0xff };
}

/**
 * Turn a key name into the three byte keymap entry the firmware stores.
 * "A", "Ctrl+Shift+A", "Mouse 4", "Fn 3", "Unassigned" and raw
 * { type, code1, code2 } objects are all accepted.
 */
export function resolveKey(spec) {
  if (spec && typeof spec === 'object') {
    return {
      type: spec.type ?? KEY_TYPES.BASIC,
      code1: spec.code1 ?? 0,
      code2: spec.code2 ?? 0,
    };
  }
  const text = String(spec ?? '').trim();
  if (!text || /^(none|unassigned|empty|clear|off)$/i.test(text)) {
    return { type: KEY_TYPES.EMPTY, code1: 0, code2: 0 };
  }

  const lower = text.toLowerCase();
  const media = MEDIA_KEYS.find(k => k.name.toLowerCase() === lower);
  if (media) return { type: KEY_TYPES.MEDIA, code1: media.code, code2: media.sub };
  const mouse = MOUSE_BUTTONS.find(b => b.name.toLowerCase() === lower);
  if (mouse) return { type: KEY_TYPES.MOUSE, code1: mouse.code, code2: 0 };
  const power = POWER_KEYS.find(p => p.name.toLowerCase() === lower);
  if (power) return { type: KEY_TYPES.POWER, code1: power.code, code2: 0 };
  const advanced = ADVANCED_KEYS.find(a => a.name.toLowerCase() === lower);
  if (advanced) return { type: KEY_TYPES.ICON, code1: advanced.code, code2: 0 };
  if (lower === 'fn') return { type: KEY_TYPES.FN, code1: 1, code2: 1 };

  let modifiers = 0;
  const rest = [];
  for (const part of text.split('+').map(p => p.trim()).filter(Boolean)) {
    const mod = MODIFIER_BITS.find(m => m.name.toLowerCase() === part.toLowerCase() || m.id === part.toLowerCase());
    if (mod) { modifiers |= mod.bit; continue; }
    rest.push(part);
  }

  const name = rest.join('+');
  if (!name) {
    if (!modifiers) throw new Error(`Unknown key name: "${text}"`);
    return { type: KEY_TYPES.BASIC, code1: modifiers, code2: 0 };
  }
  const usage = USAGE_BY_NAME.get(name) ?? USAGE_BY_NAME.get(ALIASES[name.toLowerCase()]);
  if (usage === undefined) throw new Error(`Unknown key name: "${name}"`);
  return { type: KEY_TYPES.BASIC, code1: modifiers, code2: usage };
}

/** The lighting effects the board supports, read from the layout file. */
export function effectCatalogue() {
  const file = path.join(root, 'layout', '320f_5055_2.json');
  const layout = JSON.parse(fs.readFileSync(file, 'utf8'));
  return lightingEffects(layout.lighting.backlight).map(effect => ({
    id: effect.value,
    name: effect.name,
    uses: {
      brightness: !!effect.brightness,
      speed: !!effect.speed,
      direction: !!effect.direction,
      colour: !!effect.color,
      palette: !!effect.palette,
    },
  }));
}

export class RoninSession {
  constructor({ transport = 'auto' } = {}) {
    this.want = transport;
    this.bridge = null;
    this.client = null;
    this.mode = null;
    this._board = null;
    this._matrix = null;
    this._slotByName = new Map();
  }

  /** Open the keyboard and hand a protocol client to the caller. */
  async open() {
    if (this.client && this.mode === 'bridge') return this.client;
    if (this.mode === 'hid' && this.client?.device) return this.client;

    if (this.want === 'bridge' || this.want === 'auto') {
      const bridge = new BridgeTransport(BRIDGE_URL);
      try {
        await bridge.connect();
        this.bridge = bridge;
        this.mode = 'bridge';
        this.client = new Ronin({ transport: bridge });
        return this.client;
      } catch (error) {
        try { bridge.ws?.close(); } catch { /* already closed */ }
        if (this.want === 'bridge') {
          throw new Error(`Cannot reach the local bridge at ${BRIDGE_URL}. Start it with "npm run web". (${error.message})`);
        }
      }
    }

    this.mode = 'hid';
    this.client = new Ronin();
    this.client.open();
    return this.client;
  }

  /** Release the keyboard again so other programs can take it. */
  async release() {
    if (this.mode === 'hid') {
      this.client?.close();
      this.client = null;
      this.mode = null;
    }
  }

  async close() {
    await this.release();
    if (this.bridge) {
      try { await this.bridge.disconnect(); } catch { /* already gone */ }
      this.bridge = null;
    }
  }

  /** Run a piece of work against the keyboard. */
  async withDevice(fn) {
    const client = await this.open();
    try {
      return await fn(client);
    } finally {
      await this.release();
    }
  }

  /**
   * The physical board: which keymap slot each visible key occupies.
   * Built from the vendor layout plus the keyboard's own factory keymap.
   */
  async board(client) {
    if (this._board) return this._board;
    const layout = JSON.parse(fs.readFileSync(path.join(root, 'layout', 'ronin-device.json'), 'utf8'));
    const factory = await client.getKeymap(0, true);
    const board = buildBoard(layout, factory.keys);
    this._board = board;
    this._slotByName = new Map();
    for (const key of board.keys) {
      if (key.slot === null || !key.name) continue;
      this._slotByName.set(key.name.toLowerCase(), key.slot);
    }
    return board;
  }

  /** Find the keymap slot of a physical key ("F5") or a raw slot number. */
  async resolveSlot(client, { key, slot }) {
    if (slot !== undefined && slot !== null) {
      const index = Number(slot);
      if (!Number.isInteger(index) || index < 0 || index >= P.KEYMAP_SLOTS) {
        throw new Error(`Slot must be a number between 0 and ${P.KEYMAP_SLOTS - 1}.`);
      }
      return index;
    }
    if (key === undefined || key === null || key === '') {
      throw new Error('Each assignment needs a key name or a slot number.');
    }
    await this.board(client);
    const name = String(key).trim().toLowerCase();
    if (this._slotByName.has(name)) return this._slotByName.get(name);
    if (USAGE_BY_NAME.has(key)) {
      // a key name that is not on the board (a numpad key on a TKL, say)
      const usage = USAGE_BY_NAME.get(key);
      const layoutKey = this._board.keys.find(k => k.usage === usage);
      if (layoutKey && layoutKey.slot !== null) return layoutKey.slot;
    }
    throw new Error(`No physical key called "${key}" on this board. Use ronin_keymap_read to list the keys.`);
  }

  /** The physical name of a slot, or null when the slot is not on the board. */
  nameOfSlot(slot) {
    if (!this._board) return null;
    const key = this._board.keys.find(k => k.slot === slot);
    return key ? key.name : null;
  }

  /**
   * The colour table index a key uses. The firmware addresses the per-key
   * colours through the light matrix, so a key's colour does not live in the
   * slot with the same number.
   */
  async colourIndex(client, slot) {
    if (!this._matrix) this._matrix = await client.getLightMatrix();
    const index = this._matrix[slot];
    return index === 0xff ? null : index;
  }

  /** The physical key that owns a colour table index. */
  keyForColourIndex(index) {
    if (!this._matrix) return null;
    const slot = this._matrix.findIndex(value => value === index);
    return slot === -1 ? null : this.nameOfSlot(slot);
  }
}

export { decodeKey, P };
