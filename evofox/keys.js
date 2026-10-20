/**
 * Key catalogue and keymap codec shared by the browser app and the CLI.
 *
 * A keymap entry is three bytes: (type, code1, code2).
 */

export const MODIFIER_BITS = [
  { bit: 0x01, id: 'ctrl', name: 'Ctrl', hid: 224 },
  { bit: 0x02, id: 'shift', name: 'Shift', hid: 225 },
  { bit: 0x04, id: 'alt', name: 'Alt', hid: 226 },
  { bit: 0x08, id: 'win', name: 'Win', hid: 227 },
  { bit: 0x10, id: 'rctrl', name: 'RCtrl', hid: 228 },
  { bit: 0x20, id: 'rshift', name: 'RShift', hid: 229 },
  { bit: 0x40, id: 'ralt', name: 'RAlt', hid: 230 },
  { bit: 0x80, id: 'rwin', name: 'RWin', hid: 231 },
];

export const HID_NAMES = {
  0: '', 4: 'A', 5: 'B', 6: 'C', 7: 'D', 8: 'E', 9: 'F', 10: 'G', 11: 'H', 12: 'I', 13: 'J',
  14: 'K', 15: 'L', 16: 'M', 17: 'N', 18: 'O', 19: 'P', 20: 'Q', 21: 'R', 22: 'S', 23: 'T',
  24: 'U', 25: 'V', 26: 'W', 27: 'X', 28: 'Y', 29: 'Z',
  30: '1', 31: '2', 32: '3', 33: '4', 34: '5', 35: '6', 36: '7', 37: '8', 38: '9', 39: '0',
  40: 'Enter', 41: 'Esc', 42: 'Backspace', 43: 'Tab', 44: 'Space', 45: '-', 46: '=',
  47: '[', 48: ']', 49: '\\', 50: 'ISO \\', 51: ';', 52: "'", 53: '`', 54: ',', 55: '.', 56: '/',
  57: 'Caps', 58: 'F1', 59: 'F2', 60: 'F3', 61: 'F4', 62: 'F5', 63: 'F6', 64: 'F7',
  65: 'F8', 66: 'F9', 67: 'F10', 68: 'F11', 69: 'F12',
  70: 'Print', 71: 'Scroll', 72: 'Pause', 73: 'Insert', 74: 'Home', 75: 'Page Up',
  76: 'Delete', 77: 'End', 78: 'Page Down', 79: 'Right', 80: 'Left', 81: 'Down', 82: 'Up',
  83: 'Num Lock', 84: 'Num /', 85: 'Num *', 86: 'Num -', 87: 'Num +', 88: 'Num Enter',
  89: 'Num 0', 90: 'Num 1', 91: 'Num 2', 92: 'Num 3', 93: 'Num 4', 94: 'Num 5',
  95: 'Num 6', 96: 'Num 7', 97: 'Num 8', 98: 'Num 9', 99: 'Num .', 100: 'ISO Backslash',
  101: 'Menu', 104: 'F13', 135: 'IntlRo',
  136: 'Katakana', 138: 'Convert', 139: 'Kana Hiragana', 144: 'Lang 1', 145: 'Lang 2',
  174: 'Fn',
  224: 'LCtrl', 225: 'LShift', 226: 'LAlt', 227: 'LWin',
  228: 'RCtrl', 229: 'RShift', 230: 'RAlt', 231: 'RWin',
};

export const MEDIA_KEYS = [
  { code: 131, sub: 0, name: 'Play' },
  { code: 131, sub: 1, name: 'Multimedia' },
  { code: 181, sub: 0, name: 'Next Track' },
  { code: 182, sub: 0, name: 'Previous Track' },
  { code: 183, sub: 0, name: 'Stop' },
  { code: 205, sub: 0, name: 'Play / Pause' },
  { code: 207, sub: 0, name: 'Siri' },
  { code: 226, sub: 0, name: 'Mute' },
  { code: 233, sub: 0, name: 'Volume Up' },
  { code: 234, sub: 0, name: 'Volume Down' },
  { code: 111, sub: 0, name: 'Brightness Up' },
  { code: 112, sub: 0, name: 'Brightness Down' },
  { code: 35, sub: 2, name: 'Homepage' },
  { code: 36, sub: 2, name: 'Web Backward' },
  { code: 37, sub: 2, name: 'Web Forward' },
  { code: 38, sub: 2, name: 'Web Stop' },
  { code: 39, sub: 2, name: 'Web Refresh' },
  { code: 42, sub: 2, name: 'Web Favorites' },
  { code: 33, sub: 2, name: 'Web Search' },
  { code: 146, sub: 1, name: 'Calculator' },
  { code: 148, sub: 1, name: 'My Computer' },
  { code: 138, sub: 1, name: 'Mail' },
  { code: 160, sub: 0, name: 'Launchpad' },
  { code: 175, sub: 0, name: 'Select' },
  { code: 176, sub: 0, name: 'Eject' },
  { code: 188, sub: 0, name: 'Rewind' },
  { code: 187, sub: 0, name: 'Fast Forward' },
];

export const MOUSE_BUTTONS = [
  { code: 1, name: 'Left Button' },
  { code: 2, name: 'Right Button' },
  { code: 4, name: 'Middle Button' },
  { code: 8, name: 'Forward' },
  { code: 16, name: 'Backward' },
];

export const POWER_KEYS = [
  { code: 1, name: 'Power' },
  { code: 2, name: 'Sleep' },
  { code: 4, name: 'Wake' },
];

export const KEY_TYPES = {
  BASIC: 32,
  BASIC_ALT: 18,
  MOUSE: 16,
  MEDIA: 48,
  POWER: 64,
  ICON: 80,
  FN: 31,
  FN_ALT: 160,
  MACRO: 112,
  MACRO_REPLAY: 113,
  EMPTY: 0,
};

/**
 * Vendor "advanced" keys (type 80). The firmware stores the id in code1.
 * Ids that do not exist on this board (logo/side/matrix light, LCD) are kept
 * for completeness, the keyboard simply ignores them.
 */
export const ADVANCED_KEYS = [
  [1, 'Fn 0'], [2, 'Fn 1'], [3, 'Fn 2'], [4, 'Fn 3'],
  [5, 'To 0'], [6, 'To 1'], [7, 'To 2'], [8, 'To 3'],
  [9, 'Key Light Toggle'], [10, 'Key Light Mode +'], [11, 'Key Light Mode -'],
  [12, 'Key Light Hue +'], [13, 'Key Light Hue -'],
  [14, 'Key Light Bright +'], [15, 'Key Light Bright -'],
  [16, 'Key Light Speed +'], [17, 'Key Light Speed -'],
  [18, 'Colour Board'],
  [19, 'Custom Light 1'], [20, 'Custom Light 2'], [21, 'Custom Light 3'],
  [22, 'Custom Light 4'], [23, 'Custom Light 5'],
  [24, 'Logo Light Toggle'], [25, 'Logo Light Mode +'], [26, 'Logo Light Mode -'],
  [27, 'Logo Light Hue +'], [28, 'Logo Light Hue -'],
  [29, 'Logo Light Bright +'], [30, 'Logo Light Bright -'],
  [31, 'Logo Light Speed +'], [32, 'Logo Light Speed -'],
  [33, 'Side Light Toggle'], [34, 'Side Light Mode +'], [35, 'Side Light Mode -'],
  [36, 'Side Light Hue +'], [37, 'Side Light Hue -'],
  [38, 'Side Light Bright +'], [39, 'Side Light Bright -'],
  [40, 'Side Light Speed +'], [41, 'Side Light Speed -'],
  [42, 'Matrix Light Toggle'], [43, 'Matrix Light Mode +'], [44, 'Matrix Light Mode -'],
  [45, 'Matrix Light Hue +'], [46, 'Matrix Light Hue -'],
  [47, 'Matrix Light Bright +'], [48, 'Matrix Light Bright -'],
  [49, 'Matrix Light Speed +'], [50, 'Matrix Light Speed -'],
  [51, 'Reset'],
  [52, 'BLE Mode 1'], [53, 'BLE Mode 2'], [54, 'BLE Mode 3'],
  [55, '2.4G Mode'], [56, 'USB Mode'], [57, 'Battery Status'],
  [58, '6K/NK Toggle'], [59, 'Win Toggle'], [60, 'Win Lock Toggle'],
  [61, 'WASD Toggle'], [62, 'Key Delay Toggle'], [63, 'F-Row Mode Toggle'],
  [64, 'Wheel Function Toggle'], [65, 'All Power Toggle'],
  [66, 'LCD Power Toggle'], [67, 'LCD Mode Toggle'], [68, 'LCD GIF Mode Toggle'],
  [69, 'LCD USB Toggle'],
  [70, 'Wheel Left'], [71, 'Wheel Right'], [72, 'Wheel Confirm'],
  [73, 'Test Mode'],
].map(([code, name]) => ({ code, name }));

const MEDIA_BY_KEY = new Map(MEDIA_KEYS.map(k => [`${k.code}:${k.sub}`, k.name]));

/** Human readable name for a keymap entry. */
export function decodeKey(type, code1, code2) {
  switch (type) {
    case KEY_TYPES.BASIC:
    case KEY_TYPES.BASIC_ALT: {
      const mods = MODIFIER_BITS.filter(m => code1 & m.bit).map(m => m.name);
      const key = HID_NAMES[code2] !== undefined ? HID_NAMES[code2] : `hid:${code2}`;
      if (!mods.length) return key;
      return key ? `${mods.join('+')}+${key}` : mods.join('+');
    }
    case KEY_TYPES.MEDIA:
      return MEDIA_BY_KEY.get(`${code1}:${code2}`) || `media:${code1}/${code2}`;
    case KEY_TYPES.MOUSE: {
      const button = MOUSE_BUTTONS.find(b => b.code === code1);
      return (button ? button.name : `mouse:${code1}`) + (code2 === 1 ? ' (wheel)' : '');
    }
    case KEY_TYPES.POWER: {
      const p = POWER_KEYS.find(p => p.code === code1);
      return p ? p.name : `power:${code1}`;
    }
    case KEY_TYPES.MACRO:
    case KEY_TYPES.MACRO_REPLAY:
      return `M${code1 + 1}${type === KEY_TYPES.MACRO_REPLAY ? ` x${code2}` : ''}`;
    case KEY_TYPES.FN:
    case KEY_TYPES.FN_ALT:
      return 'Fn';
    case KEY_TYPES.ICON:
      return `icon:${code1}/${code2}`;
    case KEY_TYPES.EMPTY:
      return code1 === 0 && code2 === 0 ? '' : `(${type},${code1},${code2})`;
    default:
      return `type${type}(${code1},${code2})`;
  }
}

/** Modifier-only entry: code1 = single bit, code2 = 0. */
export function modifierEntry(bit) {
  return { type: KEY_TYPES.BASIC, code1: bit, code2: 0 };
}

/** Ordinary key entry, optionally with modifiers. */
export function basicEntry(usage, modifiers = 0) {
  if (!modifiers) return { type: KEY_TYPES.BASIC, code1: 0, code2: usage };
  const single = MODIFIER_BITS.find(m => m.bit === modifiers);
  if (single) return { type: KEY_TYPES.BASIC, code1: single.bit, code2: 0 };
  return { type: KEY_TYPES.BASIC, code1: modifiers, code2: usage };
}

/** KeyboardEvent.code -> HID usage, used by the macro recorder. */
export const WEBCODE_TO_USAGE = {
  Escape: 41, Backspace: 42, Tab: 43, Space: 44, Enter: 40, CapsLock: 57,
  Minus: 45, Equal: 46, BracketLeft: 47, BracketRight: 48, Backslash: 49,
  Semicolon: 51, Quote: 52, Backquote: 53, Comma: 54, Period: 55, Slash: 56,
  IntlRo: 135, IntlYen: 137, ContextMenu: 101,
  ControlLeft: 224, ShiftLeft: 225, AltLeft: 226, MetaLeft: 227, OSLeft: 227,
  ControlRight: 228, ShiftRight: 229, AltRight: 230, MetaRight: 231, OSRight: 231,
  Digit1: 30, Digit2: 31, Digit3: 32, Digit4: 33, Digit5: 34,
  Digit6: 35, Digit7: 36, Digit8: 37, Digit9: 38, Digit0: 39,
  KeyA: 4, KeyB: 5, KeyC: 6, KeyD: 7, KeyE: 8, KeyF: 9, KeyG: 10, KeyH: 11,
  KeyI: 12, KeyJ: 13, KeyK: 14, KeyL: 15, KeyM: 16, KeyN: 17, KeyO: 18, KeyP: 19,
  KeyQ: 20, KeyR: 21, KeyS: 22, KeyT: 23, KeyU: 24, KeyV: 25, KeyW: 26, KeyX: 27,
  KeyY: 28, KeyZ: 29,
  F1: 58, F2: 59, F3: 60, F4: 61, F5: 62, F6: 63, F7: 64, F8: 65, F9: 66,
  F10: 67, F11: 68, F12: 69, F13: 104,
  PrintScreen: 70, ScrollLock: 71, Pause: 72, Insert: 73, Home: 74, PageUp: 75,
  Delete: 76, End: 77, PageDown: 78, ArrowRight: 79, ArrowLeft: 80, ArrowDown: 81,
  ArrowUp: 82, NumLock: 83, NumpadDivide: 84, NumpadMultiply: 85, NumpadSubtract: 86,
  NumpadAdd: 87, NumpadEnter: 88, Numpad0: 89, Numpad1: 90, Numpad2: 91, Numpad3: 92,
  Numpad4: 93, Numpad5: 94, Numpad6: 95, Numpad7: 96, Numpad8: 97, Numpad9: 98,
  NumpadDecimal: 99,
};

/** Curated list of assignable keys for the picker. */
export const KEY_CATALOG = (() => {
  const groups = [
    ['Letters', [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29]],
    ['Digits', [30, 31, 32, 33, 34, 35, 36, 37, 38, 39]],
    ['Function', [58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 104]],
    ['Control', [41, 42, 43, 44, 40, 57, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 100]],
    ['Navigation', [70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 101]],
    ['Numpad', [83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99]],
    ['Modifiers', [224, 225, 226, 227, 228, 229, 230, 231]],
  ];
  const out = [];
  for (const [group, usages] of groups) {
    for (const usage of usages) {
      out.push({ usage, label: HID_NAMES[usage] || `hid:${usage}`, group });
    }
  }
  return out;
})();
