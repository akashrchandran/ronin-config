/**
 * EvoFox Ronin configuration protocol (USB VID 0x320F / PID 0x5055).
 *
 * Pure, transport-free description of the wire format so the browser app
 * (WebHID), the local bridge and the Node client all speak the same thing.
 *
 * Frame (request), 63 bytes:
 *   [0] phase   0 normal, 1 start comm, 2 stop comm
 *   [1] arg0    command specific (layer index for keymap commands)
 *   [2] CMD
 *   [3] LEN     payload length
 *   [4..] args
 *
 * Frame (response), 63 bytes:
 *   [0] phase echo, [1] 0, [2] CMD echo, [3] LEN echo, [4] 0, [5] 0,
 *   [6] STATUS (0x00 ACK, 0xFF NAK), [7..] payload
 */

export const VID = 0x320f;
export const PID = 0x5055;
export const USAGE_PAGE = 0xff1c;
export const USAGE = 0x0092;
export const REPORT_ID = 4;
export const DATA_LEN = 63;
export const CHUNK = 56;

export const KEYMAP_SLOTS = 128;
export const KEYMAP_BYTES = KEYMAP_SLOTS * 3;
export const LAYERS = 4;
export const COLOR_KEYS = 128;
export const LIGHT_MATRIX_SIZE = 128;

// Lighting limits on the VS11K09A controller.
export const MAX_BRIGHTNESS = 4;
export const MAX_SPEED = 4;      // the firmware stores 4 - speed
export const RGB_MAX = 247;      // firmware clamps colour channels to 0xF7
export const MODE_CUSTOM = 19;   // per-key RGB mode (measured: 20 is "off")
export const MODE_OFF = 20;

// The board keeps three lighting profiles in flash, 0x40 bytes apart.
export const PROFILE_COUNT = 3;
export const PROFILE_OFFSETS = [0x00, 0x40, 0x80];

export const CMD = {
  START_COMM: 0x01,
  STOP_COMM: 0x02,
  GET_DEVICE_BASE_INFO: 0x03,
  GET_FUNC_INFO: 0x05,
  SET_FUNC_INFO: 0x06,
  GET_DEFAULT_KEYMAP: 0x07,
  GET_KEYMAP: 0x08,
  SET_KEYMAP: 0x09,
  GET_USER_KEY_COLORS: 0x0a,
  SET_USER_KEY_COLORS: 0x0b,
  RESTORE_FACTORY_SETTINGS: 0x0d,
  SET_MACRO_V2: 0x15,
  GET_LIGHT_MATRIX: 0x1b,
};

export const STATUS_ACK = 0x00;
export const STATUS_NAK = 0xff;

export function u16le(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

export function le16(value) {
  return [value & 0xff, (value >> 8) & 0xff];
}

/** Sum of bytes modulo 256 (the vendor's checksum). */
export function sum8(bytes) {
  let total = 0;
  for (const b of bytes) total = (total + b) & 0xff;
  return total;
}

/** Build a 63-byte request frame. */
export function buildFrame(arg0, cmd, len, args = [], head = 0) {
  const frame = new Uint8Array(DATA_LEN);
  frame[0] = head & 0xff;
  frame[1] = arg0 & 0xff;
  frame[2] = cmd & 0xff;
  frame[3] = len & 0xff;
  args.forEach((value, i) => { if (4 + i < DATA_LEN) frame[4 + i] = value & 0xff; });
  return frame;
}

/**
 * Match an incoming report against the expected command.
 * Chrome may or may not prefix HIDInputReportEvent.data with the report id.
 */
export function parseFrame(bytes, cmd) {
  if (!bytes || bytes.length < 8) return null;
  const frame = bytes[0] === REPORT_ID ? bytes.subarray(1) : bytes;
  if (frame.length < 7 || frame[2] !== (cmd & 0xff)) return null;
  return { phase: frame[0], status: frame[6], payload: frame.subarray(7) };
}

export function parseBaseInfo(payload) {
  return {
    raw: payload,
    magic: [payload[0], payload[1]],
    protocolTag: payload[4],
    vendorId: u16le(payload, 21),
    productId: u16le(payload, 23),
    firmwareVer: u16le(payload, 25),
    profile: payload[27],
    keyboardId: payload[29],
    keyboardType: payload[30],
    protocolVer: payload[31],
  };
}

export function parseFuncInfo(payload) {
  return {
    raw: payload,
    profile: payload[0],
    lightMode: payload[1],
    lightBrightness: payload[2],
    hwSpeed: payload[3],                 // firmware stores 4 - speed
    lightSpeed: Math.max(0, MAX_SPEED - payload[3]),
    lightDirection: payload[4],
    mixColor: payload[5],                // 1 = rainbow cycle
    lightR: payload[6],
    lightG: payload[7],
    lightB: payload[8],
    stageFlag: payload[9],
    customBaseR: payload[10],
    customBaseG: payload[11],
    customBaseB: payload[12],
    lightGroup: payload[18],
    keyWasd: payload[19],
    sixKeyNoConflict: payload[20],
    lockWin: payload[21],
    reportRate: payload[22],
    hitRate: payload[23],
    hitDelay: payload[24],
    lightColor: [payload[34], payload[33], payload[32]],
  };
}

/** 384 bytes -> 128 keymap entries. */
export function parseKeymap(bytes) {
  const keys = [];
  for (let i = 0; i < KEYMAP_SLOTS; i++) {
    keys.push({
      index: i,
      type: bytes[3 * i],
      code1: bytes[3 * i + 1],
      code2: bytes[3 * i + 2],
    });
  }
  return keys;
}

export function serializeKeymap(keys) {
  const bytes = new Uint8Array(KEYMAP_BYTES);
  for (let i = 0; i < KEYMAP_SLOTS; i++) {
    const key = keys[i] || { type: 0, code1: 0, code2: 0 };
    bytes[3 * i] = key.type & 0xff;
    bytes[3 * i + 1] = key.code1 & 0xff;
    bytes[3 * i + 2] = key.code2 & 0xff;
  }
  return bytes;
}

export function parseColors(bytes) {
  const colors = [];
  for (let i = 0; i < COLOR_KEYS; i++) {
    colors.push({ r: bytes[3 * i], g: bytes[3 * i + 1], b: bytes[3 * i + 2] });
  }
  return colors;
}

export function serializeColors(colors) {
  const bytes = new Uint8Array(COLOR_KEYS * 3);
  colors.forEach((c, i) => {
    bytes[3 * i] = c.r & 0xff;
    bytes[3 * i + 1] = c.g & 0xff;
    bytes[3 * i + 2] = c.b & 0xff;
  });
  return bytes;
}

export function parseLightMatrix(bytes) {
  return Array.from(bytes.subarray(0, LIGHT_MATRIX_SIZE));
}

/**
 * The per-key colour table is addressed through the light matrix: entry
 * lightMatrix[slot] is the colour index the firmware uses for that key.
 * 0xFF means the key has no per-key colour slot.
 */
export function colourIndexBySlot(lightMatrix) {
  const map = new Map();
  lightMatrix.forEach((index, slot) => {
    if (index !== 0xff) map.set(slot, index);
  });
  return map;
}

/** Build the 56-byte function/lighting block. */
export function buildFuncInfo(values, base = null) {
  const block = new Uint8Array(56);
  if (base) block.set(base.subarray(0, 56));
  const map = {
    profile: 0, lightMode: 1, lightBrightness: 2, lightDirection: 4, mixColor: 5,
    lightR: 6, lightG: 7, lightB: 8,
    customBaseR: 10, customBaseG: 11, customBaseB: 12,
    lightGroup: 18, keyWasd: 19, sixKeyNoConflict: 20, lockWin: 21,
    reportRate: 22, hitRate: 23, hitDelay: 24,
  };
  for (const [key, index] of Object.entries(map)) {
    if (values[key] === undefined) continue;
    const limit = key.startsWith('lightR') || key.startsWith('lightG') || key.startsWith('lightB')
      ? RGB_MAX : 0xff;
    block[index] = Math.min(limit, Math.max(0, values[key])) & 0xff;
  }
  if (values.lightSpeed !== undefined) {
    // the firmware stores the speed inverted
    const speed = Math.max(0, Math.min(MAX_SPEED, values.lightSpeed));
    block[3] = (MAX_SPEED - speed) & 0xff;
  }
  if (values.lightColor) {
    const [r, g, b] = values.lightColor;
    block[32] = b & 0xff; block[33] = g & 0xff; block[34] = r & 0xff;
  }
  return block;
}

const MOUSE_MASK = { left: 1, right: 4, middle: 2, forward: 8, back: 16 };

/**
 * The wire events a macro step turns into: 0x0a presses, 0x8a releases.
 * A tap is one step for the user and two events on the wire.
 */
export function macroEvents(step) {
  const mode = step.mode ?? (step.release === true ? 'release' : 'hold');
  if (mode === 'hold') return [0x0a];
  if (mode === 'release') return [0x8a];
  return [0x0a, 0x8a];
}

/**
 * Build the macro block the firmware expects (1096 bytes, variable length).
 * `macros` = [{ name, index, type, replayCount, steps: [{ kind, code, button, time, mode }] }]
 *
 * A step is one action the user thinks of as one: tapping a key is a single
 * step and expands into a press and a release on the wire. `mode` picks the
 * other shapes: 'hold' presses without releasing, 'release' releases without
 * pressing. The older `release` flag is still understood: a step with
 * release:false was a press and one with release:true was a release.
 */
export function buildMacroBlock(macros) {
  const buf = new Uint8Array(1096);
  buf[0] = 0xaa;
  buf[1] = 0x55;
  const count = macros.length;
  buf[4] = count & 0xff;
  buf[5] = (count >> 8) & 0xff;

  let cursor = 16 + 2 * count;
  macros.forEach((macro, i) => {
    const steps = macro.steps || [];
    if (!steps.length) return;
    buf[16 + 2 * i] = cursor & 0xff;
    buf[17 + 2 * i] = (cursor >> 8) & 0xff;
    buf[cursor] = steps.length & 0xff;
    buf[cursor + 1] = (steps.length >> 8) & 0xff;
    cursor += 4;
    for (const step of steps) {
      const time = Math.max(10, Math.min(50000, step.time | 0));
      const code = step.kind === 'mouse'
        ? (MOUSE_MASK[step.button] || 1)
        : (step.code & 0xff);
      const events = step.kind === 'delay' ? [0x0a] : macroEvents(step);
      for (const flag of events) {
        buf[cursor] = time & 0xff;
        buf[cursor + 1] = (time >> 8) & 0xff;
        buf[cursor + 2] = flag;
        buf[cursor + 3] = code;
        cursor += 4;
      }
    }
  });
  buf[2] = cursor & 0xff;
  buf[3] = (cursor >> 8) & 0xff;
  return { bytes: buf, length: cursor };
}

/** Split a payload into 56 byte chunks plus their offsets. */
export function chunked(bytes, total = bytes.length) {
  const chunks = [];
  for (let offset = 0; offset < total; offset += CHUNK) {
    const length = Math.min(CHUNK, total - offset);
    chunks.push({ offset, length, bytes: bytes.subarray(offset, offset + length) });
  }
  return chunks;
}
