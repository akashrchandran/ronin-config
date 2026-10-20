/**
 * Transports for the Ronin configurator.
 *
 * WebHidTransport talks to the keyboard directly through the browser's WebHID
 * API (Chrome / Edge). BridgeTransport talks to a local bridge process, which
 * is useful in browsers without WebHID and for automated testing.
 */
import * as P from '../protocol.js';

function toBase64(bytes) {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(text) {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export class WebHidTransport {
  constructor() {
    this.device = null;
    this.pending = new Map();
    this.seq = 0;
    this.mode = 'webhid';
  }

  get supported() {
    return typeof navigator !== 'undefined' && 'hid' in navigator;
  }

  async connect() {
    if (!this.supported) throw new Error('This browser has no WebHID support. Use Chrome or Edge, or the local bridge.');
    const devices = await navigator.hid.requestDevice({
      filters: [{
        vendorId: P.VID,
        productId: P.PID,
        usagePage: P.USAGE_PAGE,
        usage: P.USAGE,
      }],
    });
    if (!devices.length) throw new Error('No device selected.');
    const device = devices[0];
    if (!device.opened) await device.open();
    device.addEventListener('inputreport', event => this._onInput(event));
    this.device = device;
    return { productName: device.productName || 'EvoFox device', mode: this.mode };
  }

  _onInput(event) {
    const bytes = new Uint8Array(event.data.buffer);
    for (const [id, req] of this.pending) {
      const parsed = P.parseFrame(bytes, req.cmd);
      if (!parsed) continue;
      this.pending.delete(id);
      if (parsed.status === P.STATUS_NAK) req.reject(new Error('device NAK'));
      else req.resolve(parsed.payload);
      return;
    }
  }

  async request(arg0, cmd, len, args = [], head = 0, timeout = 1500) {
    if (!this.device) throw new Error('Not connected.');
    const frame = P.buildFrame(arg0, cmd, len, args, head);
    const id = ++this.seq;
    const result = new Promise((resolve, reject) => {
      this.pending.set(id, { cmd, resolve, reject });
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error('Timeout waiting for the keyboard.'));
      }, timeout);
    });
    await this.device.sendReport(P.REPORT_ID, frame);
    return result;
  }

  /** One retry: the keyboard occasionally drops a reply. */
  async send(arg0, cmd, len, args = [], head = 0) {
    try {
      return await this.request(arg0, cmd, len, args, head);
    } catch (error) {
      if (!/timeout/i.test(error.message)) throw error;
      return this.request(arg0, cmd, len, args, head);
    }
  }

  async disconnect() {
    if (this.device?.opened) await this.device.close();
    this.device = null;
  }
}

export class BridgeTransport {
  constructor(url) {
    this.url = url || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/bridge`;
    this.ws = null;
    this.pending = new Map();
    this.seq = 0;
    this.mode = 'bridge';
  }

  async connect() {
    this.ws = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Bridge did not answer. Is "npm run web" running?')), 4000);
      this.ws.onopen = () => { clearTimeout(timer); resolve(); };
      this.ws.onerror = () => { clearTimeout(timer); reject(new Error('Cannot reach the local bridge.')); };
    });
    this.ws.onmessage = event => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id);
      if (message.error) entry.reject(new Error(message.error));
      else entry.resolve(message);
    };
    const info = await this._send({ t: 'info' });
    return { productName: info.productName || 'EvoFox device', mode: this.mode };
  }

  _send(payload) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ ...payload, id }));
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error('Bridge timeout.'));
      }, 5000);
    });
  }

  async request(arg0, cmd, len, args = [], head = 0) {
    const frame = P.buildFrame(arg0, cmd, len, args, head);
    const reply = await this._send({ t: 'frame', frame: toBase64(frame) });
    const parsed = P.parseFrame(fromBase64(reply.frame), cmd);
    if (!parsed) throw new Error('Unexpected reply from the bridge.');
    if (parsed.status === P.STATUS_NAK) throw new Error('device NAK');
    return parsed.payload;
  }

  /** One retry: the keyboard occasionally drops a reply. */
  async send(arg0, cmd, len, args = [], head = 0) {
    try {
      return await this.request(arg0, cmd, len, args, head);
    } catch (error) {
      if (!/timeout/i.test(error.message)) throw error;
      return this.request(arg0, cmd, len, args, head);
    }
  }

  async disconnect() {
    this.ws?.close();
    this.ws = null;
  }
}
