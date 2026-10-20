/**
 * The lighting effects the board supports.
 *
 * The shipped vendor layout file mislabels the last two effects: on this
 * firmware 19 is the per-key RGB mode and 20 switches the backlight off
 * (measured on the keyboard). Two more effects the firmware knows are not in
 * the file at all. The correction lives here so the web app and the MCP
 * server always agree on the numbers they write.
 */
import * as P from './protocol.js';

export const EXTRA_EFFECTS = [
  { value: P.MODE_CUSTOM, name: 'Custom (per-key RGB)' },
  { value: P.MODE_OFF, name: 'Off' },
  { value: 29, name: 'Audio wave' },
  { value: 30, name: 'Shadow' },
];

/**
 * @param {Array<{value:number,name:string}>} vendorBacklight the backlight
 *   effect list from the vendor layout file.
 */
export function lightingEffects(vendorBacklight) {
  return (vendorBacklight || [])
    .filter(effect => effect.value <= 18)
    .concat(EXTRA_EFFECTS.map(effect => ({ ...effect })));
}
