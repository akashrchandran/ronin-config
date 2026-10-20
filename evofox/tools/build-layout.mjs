/**
 * Build the physical layout for the Ronin from the keyboard's own factory
 * keymap.
 *
 * The vendor ships layout/320f_5055_2.json: a 79 key ANSI TKL. The board this
 * app talks to reports 120 assigned slots covering a JIS full size with a
 * numpad, so the vendor file renders the wrong keyboard and hides 48 slots.
 *
 * The table below was derived from the device's factory keymap (see
 * README.md) and the standard JIS arrangement.
 *
 * Run: node tools/build-layout.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const ROW = { FUNCTION: 0, NUMBER: 1.25, QWERTY: 2.25, HOME: 3.25, SHIFT: 4.25, BOTTOM: 5.25 };

/** [usage, x, width, row, name] */
const table = [
  // function row
  [41, 0, 1, ROW.FUNCTION, 'Esc'],
  [58, 2, 1, ROW.FUNCTION, 'F1'], [59, 3, 1, ROW.FUNCTION, 'F2'],
  [60, 4, 1, ROW.FUNCTION, 'F3'], [61, 5, 1, ROW.FUNCTION, 'F4'],
  [62, 6.5, 1, ROW.FUNCTION, 'F5'], [63, 7.5, 1, ROW.FUNCTION, 'F6'],
  [64, 8.5, 1, ROW.FUNCTION, 'F7'], [65, 9.5, 1, ROW.FUNCTION, 'F8'],
  [66, 11, 1, ROW.FUNCTION, 'F9'], [67, 12, 1, ROW.FUNCTION, 'F10'],
  [68, 13, 1, ROW.FUNCTION, 'F11'], [69, 14, 1, ROW.FUNCTION, 'F12'],
  [76, 15.5, 1, ROW.FUNCTION, 'Del'],

  // number row
  [53, 0, 1, ROW.NUMBER, '`'],
  [30, 1, 1, ROW.NUMBER, '1'], [31, 2, 1, ROW.NUMBER, '2'], [32, 3, 1, ROW.NUMBER, '3'],
  [33, 4, 1, ROW.NUMBER, '4'], [34, 5, 1, ROW.NUMBER, '5'], [35, 6, 1, ROW.NUMBER, '6'],
  [36, 7, 1, ROW.NUMBER, '7'], [37, 8, 1, ROW.NUMBER, '8'], [38, 9, 1, ROW.NUMBER, '9'],
  [39, 10, 1, ROW.NUMBER, '0'], [45, 11, 1, ROW.NUMBER, '-'], [46, 12, 1, ROW.NUMBER, '='],
  [42, 13, 2, ROW.NUMBER, 'Backspace'],
  [73, 15.5, 1, ROW.NUMBER, 'Ins'],

  // qwerty row
  [43, 0, 1.5, ROW.QWERTY, 'Tab'],
  [20, 1.5, 1, ROW.QWERTY, 'Q'], [26, 2.5, 1, ROW.QWERTY, 'W'], [8, 3.5, 1, ROW.QWERTY, 'E'],
  [21, 4.5, 1, ROW.QWERTY, 'R'], [23, 5.5, 1, ROW.QWERTY, 'T'], [28, 6.5, 1, ROW.QWERTY, 'Y'],
  [24, 7.5, 1, ROW.QWERTY, 'U'], [12, 8.5, 1, ROW.QWERTY, 'I'], [18, 9.5, 1, ROW.QWERTY, 'O'],
  [19, 10.5, 1, ROW.QWERTY, 'P'], [47, 11.5, 1, ROW.QWERTY, '['], [48, 12.5, 1, ROW.QWERTY, ']'],
  [49, 13.5, 1, ROW.QWERTY, '\\'],
  [75, 15.5, 1, ROW.QWERTY, 'Page Up'],

  // home row (JIS: ISO backslash before a narrower enter)
  [57, 0, 1.75, ROW.HOME, 'Caps'],
  [4, 1.75, 1, ROW.HOME, 'A'], [22, 2.75, 1, ROW.HOME, 'S'], [7, 3.75, 1, ROW.HOME, 'D'],
  [9, 4.75, 1, ROW.HOME, 'F'], [10, 5.75, 1, ROW.HOME, 'G'], [11, 6.75, 1, ROW.HOME, 'H'],
  [13, 7.75, 1, ROW.HOME, 'J'], [14, 8.75, 1, ROW.HOME, 'K'], [15, 9.75, 1, ROW.HOME, 'L'],
  [51, 10.75, 1, ROW.HOME, ';'], [52, 11.75, 1, ROW.HOME, "'"], [50, 12.75, 1, ROW.HOME, 'ISO \\'],
  [40, 13.75, 1.25, ROW.HOME, 'Enter'],
  [78, 15.5, 1, ROW.HOME, 'Page Down'],

  // shift row
  [225, 0, 1.25, ROW.SHIFT, 'Shift'], [100, 1.25, 1, ROW.SHIFT, 'ISO Backslash'],
  [29, 2.25, 1, ROW.SHIFT, 'Z'], [27, 3.25, 1, ROW.SHIFT, 'X'], [6, 4.25, 1, ROW.SHIFT, 'C'],
  [25, 5.25, 1, ROW.SHIFT, 'V'], [5, 6.25, 1, ROW.SHIFT, 'B'], [17, 7.25, 1, ROW.SHIFT, 'N'],
  [16, 8.25, 1, ROW.SHIFT, 'M'], [54, 9.25, 1, ROW.SHIFT, ','], [55, 10.25, 1, ROW.SHIFT, '.'],
  [56, 11.25, 1, ROW.SHIFT, '/'], [229, 12.25, 1.75, ROW.SHIFT, 'Shift'],
  [82, 19.5, 1, ROW.SHIFT, 'Up'],

  // bottom row
  [224, 0, 1.25, ROW.BOTTOM, 'Ctrl'], [227, 1.25, 1.25, ROW.BOTTOM, 'Win'],
  [226, 2.5, 1.25, ROW.BOTTOM, 'Alt'],
  [145, 3.75, 1, ROW.BOTTOM, 'Lang 2'], [139, 4.75, 1, ROW.BOTTOM, 'Kana Hiragana'],
  [138, 5.75, 1, ROW.BOTTOM, 'Convert'],
  [44, 6.75, 6.25, ROW.BOTTOM, 'Space'],
  [136, 13, 1, ROW.BOTTOM, 'Katakana'], [144, 14, 1, ROW.BOTTOM, 'Lang 1'],
  [228, 15, 1.25, ROW.BOTTOM, 'RCtrl'], [230, 16.25, 1, ROW.BOTTOM, 'RAlt'],
  [80, 18.5, 1, ROW.BOTTOM, 'Left'], [81, 19.5, 1, ROW.BOTTOM, 'Down'],
  [79, 20.5, 1, ROW.BOTTOM, 'Right'],

  // numpad (this board has no Num 0 and no Num Enter)
  [83, 21.5, 1, ROW.NUMBER, 'Num Lock'], [84, 22.5, 1, ROW.NUMBER, 'Num /'],
  [85, 23.5, 1, ROW.NUMBER, 'Num *'], [86, 24.5, 1, ROW.NUMBER, 'Num -'],
  [96, 21.5, 1, ROW.QWERTY, 'Num 7'], [97, 22.5, 1, ROW.QWERTY, 'Num 8'],
  [98, 23.5, 1, ROW.QWERTY, 'Num 9'], [87, 24.5, 1, ROW.QWERTY, 'Num +'],
  [93, 21.5, 1, ROW.HOME, 'Num 4'], [94, 22.5, 1, ROW.HOME, 'Num 5'],
  [95, 23.5, 1, ROW.HOME, 'Num 6'],
  [90, 21.5, 1, ROW.SHIFT, 'Num 1'], [91, 22.5, 1, ROW.SHIFT, 'Num 2'],
  [92, 23.5, 1, ROW.SHIFT, 'Num 3'],
  [99, 23.5, 1, ROW.BOTTOM, 'Num .'],
];

const keys = table.map(([usage, x, w, y, name]) => ({
  x, y, w, h: 1, usage, name,
}));

// The Fn key is stored as a type 160 entry, so it is matched exactly.
keys.push({ x: 17.25, y: ROW.BOTTOM, w: 1, h: 1, usage: null, name: 'Fn', entry: { type: 160, code1: 1, code2: 0 } });

const layout = {
  name: 'Ronin (from the keyboard keymap)',
  width: 25.5,
  height: 6.25,
  keys,
};
fs.writeFileSync(path.join(root, 'layout', 'ronin-device.json'), JSON.stringify(layout, null, 2));
console.log(`wrote layout/ronin-device.json with ${keys.length} keys`);
