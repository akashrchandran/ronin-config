// Live verification of the reverse-engineered Ronin protocol (read-only).
import { Ronin } from './ronin.js';

const hex = buf => Buffer.from(buf).toString('hex');

const kb = new Ronin();
kb.open();
console.log('device path:', kb.path);

await kb.startComm();

const base = await kb.getDeviceBaseInfo();
console.log('\n[base info]');
console.log('  magic        ', base.magic.map(b => '0x' + b.toString(16)).join(' '));
console.log('  vendorId     ', '0x' + base.vendorId.toString(16), '(expect 0x320f)');
console.log('  productId    ', '0x' + base.productId.toString(16), '(expect 0x5055)');
console.log('  firmwareVer  ', base.firmwareVer, '->', base.firmwareVer.toString(16).toUpperCase());
console.log('  indexed dump :');
for (let i = 0; i < base.raw.length; i += 16) {
  const row = base.raw.slice(i, i + 16).map(b => b.toString(16).padStart(2, '0'));
  console.log(`    ${String(i).padStart(2)}: ${row.join(' ')}`);
}

const fn = await kb.getFuncInfo();
console.log('\n[func info]');
console.log('  lightMode    ', fn.lightMode);
console.log('  brightness   ', fn.lightBrightness);
console.log('  speed        ', fn.lightSpeed);
console.log('  RGB          ', fn.lightR, fn.lightG, fn.lightB);
console.log('  keyWasd      ', fn.keyWasd, ' lockWin', fn.lockWin, ' reportRate', fn.reportRate);
console.log('  indexed dump :');
for (let i = 0; i < fn.raw.length; i += 16) {
  const row = fn.raw.slice(i, i + 16).map(b => b.toString(16).padStart(2, '0'));
  console.log(`    ${String(i).padStart(2)}: ${row.join(' ')}`);
}

const km = await kb.getKeymap(0, false);
console.log('\n[user keymap layer 0]  bytes:', km.bytes.length);
console.log('  first 12 keys:', km.keys.slice(0, 12)
  .map(k => `${k.index}:(0x${k.type.toString(16)},0x${k.code1.toString(16)},0x${k.code2.toString(16)})`).join(' '));

const dflt = await kb.getKeymap(0, true);
console.log('\n[default keymap layer 0] bytes:', dflt.bytes.length);
console.log('  identical to user layer 0:', hex(dflt.bytes) === hex(km.bytes));

const lm = await kb.getLightMatrix();
console.log('\n[light matrix] len', lm.length);
console.log('  ', lm.map(b => b.toString(16).padStart(2, '0')).join(' '));

const colors = await kb.getUserKeyColors();
console.log('\n[user key colors] first 8:', colors.colors.slice(0, 8)
  .map(c => `#${[c.r, c.g, c.b].map(v => v.toString(16).padStart(2, '0')).join('')}`).join(' '));

if (process.argv.includes('--write')) {
  // Write-back test: write the bytes we just read and confirm they survive.
  console.log('\n[write-back] keymap layer 0');
  const factory = await kb.getKeymap(0, true);
  await kb.setKeymap(0, factory.keys);
  const after = await kb.getKeymap(0, false);
  console.log('  identical after write:', hex(after.bytes) === hex(factory.bytes));

  console.log('[write-back] function info');
  const fnBefore = await kb.getFuncInfo();
  await kb.setFuncInfoRaw(fnBefore.raw);
  const fnAfter = await kb.getFuncInfo();
  console.log('  identical after write:', hex(fnAfter.raw) === hex(fnBefore.raw));
}

await kb.stopComm();
kb.close();
console.log('\nOK');
process.exit(0);
