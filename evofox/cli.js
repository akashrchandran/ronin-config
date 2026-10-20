#!/usr/bin/env node
/**
 * ronin — CLI for the EvoFox Ronin configuration protocol (0x320F:0x5055).
 *
 *   node cli.js info                 device + function settings
 *   node cli.js keymap [--layer N] [--default]
 *   node cli.js light                per-key lighting matrix
 *   node cli.js colors               per-key RGB colours
 *   node cli.js raw <cmd> [len] [args...]
 */
import { Ronin } from './ronin.js';
import * as P from './protocol.js';
import { decodeKey } from './keys.js';

const argv = process.argv.slice(2);
const cmd = argv.shift();

const flag = (name, dflt) => {
  const i = argv.indexOf(name);
  return i === -1 ? dflt : argv[i + 1];
};
const has = name => argv.includes(name);

const kb = new Ronin();
kb.open();
await kb.startComm();

switch (cmd) {
  case 'info': {
    const base = await kb.getDeviceBaseInfo();
    const fn = await kb.getFuncInfo();
    console.log('device      :', '0x' + base.vendorId.toString(16), '0x' + base.productId.toString(16));
    console.log('firmware    :', base.firmwareVer.toString(16).toUpperCase());
    console.log('light mode  :', fn.lightMode, ' brightness', fn.lightBrightness, ' speed', fn.lightSpeed);
    console.log('light RGB   :', fn.lightR, fn.lightG, fn.lightB);
    console.log('light group :', fn.lightGroup, ' wasd', fn.keyWasd, ' lockWin', fn.lockWin,
      ' reportRate', fn.reportRate);
    break;
  }
  case 'keymap': {
    const layer = parseInt(flag('--layer', '0'), 10);
    const km = await kb.getKeymap(layer, has('--default'));
    console.log(`layer ${layer}${has('--default') ? ' (factory)' : ''}:`);
    for (const key of km.keys) {
      const name = decodeKey(key.type, key.code1, key.code2);
      if (name) console.log(`  ${String(key.index).padStart(3)}  ${name}`);
    }
    break;
  }
  case 'light': {
    const lm = await kb.getLightMatrix();
    console.log('light matrix (0xff = unset):');
    for (let i = 0; i < lm.length; i += 16) {
      console.log('  ' + String(i).padStart(3) + ': ' +
        lm.slice(i, i + 16).map(b => b.toString(16).padStart(2, '0')).join(' '));
    }
    break;
  }
  case 'colors': {
    const c = await kb.getUserKeyColors();
    console.log('per-key colours:');
    c.colors.forEach((k, i) => {
      const hex = '#' + [k.r, k.g, k.b].map(v => v.toString(16).padStart(2, '0')).join('');
      console.log(`  ${String(i).padStart(3)}  ${hex}`);
    });
    break;
  }
  case 'raw': {
    const c = parseInt(argv[0], 16);
    const len = parseInt(argv[1] || '0', 10);
    const args = argv.slice(2).map(v => parseInt(v, 16));
    const r = await kb.request(0, c, len, args);
    console.log('response payload:', Buffer.from(r.payload).toString('hex'));
    break;
  }
  default:
    console.log('usage: cli.js <info|keymap|light|colors|raw> [options]');
    console.log('commands:', Object.entries(P.CMD).map(([k, v]) => `${k}=0x${v.toString(16)}`).join(' '));
}

await kb.stopComm();
kb.close();
process.exit(0);
