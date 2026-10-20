/**
 * evofox-ronin — Node client for the EvoFox Ronin TKL configuration protocol.
 *
 * Uses node-hid to reach the vendor HID collection (usage page 0xFF1C,
 * usage 0x0092) of USB device 0x320F:0x5055 and speaks the frame format
 * described in protocol.js.
 */
import hid from 'node-hid';
import * as P from './protocol.js';
import { decodeKey } from './keys.js';

export { P, decodeKey };

export class RoninError extends Error {}

export class Ronin {
  /**
   * @param {string|{path?:string, transport?:object}} [target] an explicit HID
   *   path, an options object, or nothing to auto-detect. A `transport` may be
   *   injected to run the same protocol over another channel - the local
   *   bridge does this, so the protocol code stays in one place.
   */
  constructor(target) {
    const options = target && typeof target === 'object' ? target : { path: target };
    this.path = options.path ?? (options.transport ? null : Ronin.findDevice());
    this.transport = options.transport || null;
    this.device = null;
    this._inbox = [];
  }

  static listDevices() {
    return hid.devices()
      .filter(d => d.vendorId === P.VID && d.productId === P.PID)
      .map(d => ({ path: d.path, usagePage: d.usagePage, usage: d.usage, product: d.product }));
  }

  static findDevice() {
    const dev = hid.devices().find(d =>
      d.vendorId === P.VID && d.productId === P.PID && d.usagePage === P.USAGE_PAGE);
    if (!dev) {
      // In Bluetooth mode the firmware swaps the configuration collection for
      // a read-only one, so the keyboard cannot be configured at all.
      const wireless = hid.devices().some(d =>
        d.vendorId === P.VID && d.productId === P.PID && d.usagePage === 0xff01);
      throw new RoninError(wireless
        ? 'EvoFox Ronin found, but it is in Bluetooth mode. The configuration collection only exists in USB mode - switch the keyboard back to USB.'
        : 'EvoFox Ronin (0x320F:0x5055, usage page 0xFF1C) not found');
    }
    return dev.path;
  }

  open() {
    if (this.transport) return this;
    if (this.device) return this;
    this.device = new hid.HID(this.path);
    // node-hid starts its own read loop once a 'data' listener is attached
    this.device.on('data', d => this._inbox.push(Uint8Array.from(d)));
    this.device.on('error', e => { this._lastError = new RoninError(e.message); });
    return this;
  }

  close() {
    if (this.transport) return;
    if (this.device) { this.device.close(); this.device = null; }
  }

  /** Send a frame and wait for the matching response. */
  async request(arg0, cmd, len, args = [], { timeout = 1500, head = 0 } = {}) {
    if (this.transport) {
      const payload = await this.transport.request(arg0, cmd, len, args, head, timeout);
      return { raw: null, payload, phase: 0 };
    }
    if (!this.device) this.open();
    const frame = P.buildFrame(arg0, cmd, len, args, head);
    const out = Buffer.alloc(P.DATA_LEN + 1);
    out[0] = P.REPORT_ID;
    Buffer.from(frame).copy(out, 1);
    this._inbox.length = 0;
    this.device.write(Array.from(out));

    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const msg = this._inbox.shift();
      if (!msg) { await sleep(5); continue; }
      const parsed = P.parseFrame(msg, cmd);
      if (!parsed) continue;
      if (parsed.status === P.STATUS_NAK) {
        throw new RoninError(`device NAK (cmd 0x${cmd.toString(16)})`);
      }
      if (parsed.status !== P.STATUS_ACK) {
        throw new RoninError(`unexpected status 0x${parsed.status.toString(16)} (cmd 0x${cmd.toString(16)})`);
      }
      return { raw: msg, payload: parsed.payload, phase: parsed.phase };
    }
    throw new RoninError(`timeout waiting for response to cmd 0x${cmd.toString(16)}`);
  }

  /**
   * Send a prebuilt 63-byte frame and return the raw reply (report id first).
   * Used by the local bridge so the browser keeps ownership of the protocol.
   */
  async rawRequest(frame, { timeout = 1500 } = {}) {
    if (!this.device) this.open();
    const cmd = frame[2];
    const out = Buffer.alloc(P.DATA_LEN + 1);
    out[0] = P.REPORT_ID;
    Buffer.from(frame).copy(out, 1);
    this._inbox.length = 0;
    this.device.write(Array.from(out));

    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const msg = this._inbox.shift();
      if (!msg) { await sleep(5); continue; }
      const parsed = P.parseFrame(msg, cmd);
      if (!parsed) continue;
      return Uint8Array.from(msg);
    }
    throw new RoninError('timeout waiting for the keyboard');
  }

  // ---- protocol ----------------------------------------------------------

  async startComm() { await this.request(0, P.CMD.START_COMM, 0, [], { head: 1 }); }
  async stopComm() { await this.request(0, P.CMD.STOP_COMM, 0, [], { head: 2 }); }

  async getDeviceBaseInfo() {
    const { payload } = await this.request(0, P.CMD.GET_DEVICE_BASE_INFO, 34);
    return P.parseBaseInfo(payload);
  }

  /**
   * Read the lighting configuration of one of the three onboard profiles
   * (flash offsets 0x00, 0x40, 0x80).
   */
  async getFuncInfo(profile = 0) {
    const offset = P.PROFILE_OFFSETS[profile] ?? 0;
    const { payload } = await this.request(0, P.CMD.GET_FUNC_INFO, 56,
      [offset & 0xff, (offset >> 8) & 0xff, 0]);
    return P.parseFuncInfo(payload);
  }

  async getKeymap(layer = 0, isDefault = false) {
    const cmd = isDefault ? P.CMD.GET_DEFAULT_KEYMAP : P.CMD.GET_KEYMAP;
    const out = [];
    for (let off = 0; off < P.KEYMAP_BYTES; off += P.CHUNK) {
      const len = Math.min(P.CHUNK, P.KEYMAP_BYTES - off);
      const { payload } = await this.request(layer, cmd, len, [off & 0xff, (off >> 8) & 0xff, 0]);
      out.push(...payload);
    }
    const bytes = Uint8Array.from(out);
    return { bytes, keys: P.parseKeymap(bytes) };
  }

  async getUserKeyColors() {
    // No priming read: the firmware advances its read pointer by the length of
    // every request, and a throwaway read in front of the chunks shifts the
    // whole table.
    const out = [];
    for (let off = 0; off < P.COLOR_KEYS * 3; off += P.CHUNK) {
      const len = Math.min(P.CHUNK, P.COLOR_KEYS * 3 - off);
      const { payload } = await this.request(0, P.CMD.GET_USER_KEY_COLORS, len,
        [off & 0xff, (off >> 8) & 0xff, 0]);
      out.push(...payload);
    }
    const bytes = Uint8Array.from(out);
    return { bytes, colors: P.parseColors(bytes) };
  }

  async getLightMatrix() {
    const out = [];
    for (let off = 0; off < P.LIGHT_MATRIX_SIZE; off += P.CHUNK) {
      const len = Math.min(P.CHUNK, P.LIGHT_MATRIX_SIZE - off);
      const { payload } = await this.request(0, P.CMD.GET_LIGHT_MATRIX, len,
        [off & 0xff, (off >> 8) & 0xff, 0]);
      out.push(...payload);
    }
    return out.slice(0, P.LIGHT_MATRIX_SIZE);
  }

  // ---- write paths -------------------------------------------------------

  /** Write the 56-byte function block verbatim to one of the onboard profiles. */
  async setFuncInfoRaw(bytes, profile = 0) {
    const offset = P.PROFILE_OFFSETS[profile] ?? 0;
    const block = Uint8Array.from(bytes).subarray(0, 56);
    while (block.length < 56) block.push(0);
    await this.startComm();
    await this.request(0, P.CMD.SET_FUNC_INFO, 56,
      [offset & 0xff, (offset >> 8) & 0xff, 0, ...block]);
    await this.stopComm();
  }

  async setFuncInfo(values, profile = 0) {
    const current = await this.getFuncInfo(profile);
    await this.setFuncInfoRaw(P.buildFuncInfo(values, current.raw), profile);
  }

  async setKeymap(layer, keys) {
    const bytes = P.serializeKeymap(keys);
    await this.startComm();
    for (const chunk of P.chunked(bytes)) {
      await this.request(0, P.CMD.SET_KEYMAP, chunk.length,
        [chunk.offset & 0xff, (chunk.offset >> 8) & 0xff, layer, ...chunk.bytes]);
    }
    await this.stopComm();
  }

  async setUserKeyColors(colors) {
    const bytes = P.serializeColors(colors);
    await this.startComm();
    for (const chunk of P.chunked(bytes)) {
      // three address bytes plus the chunk fill the 63 byte frame exactly,
      // which leaves no room for the vendor's trailing checksum byte
      await this.request(0, P.CMD.SET_USER_KEY_COLORS, chunk.length,
        [chunk.offset & 0xff, (chunk.offset >> 8) & 0xff, 0, ...chunk.bytes]);
    }
    await this.stopComm();
  }

  /**
   * Push the macro list. The vendor always ships full 56 byte chunks and
   * declares the real length in the last chunk's LEN field.
   */
  async setMacros(macros) {
    const { bytes, length } = P.buildMacroBlock(macros);
    await this.startComm();
    const count = Math.max(1, Math.ceil(length / P.CHUNK));
    for (let i = 0; i < count; i++) {
      const offset = i * P.CHUNK;
      const chunk = bytes.subarray(offset, offset + P.CHUNK);
      const checksum = P.sum8(chunk);
      const len = i === count - 1 ? (length % P.CHUNK || P.CHUNK) : P.CHUNK;
      await this.request(0, P.CMD.SET_MACRO_V2, len,
        [offset & 0xff, (offset >> 8) & 0xff, checksum, ...chunk]);
    }
    await this.stopComm();
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
