/**
 * RONIN CONFIG - application controller.
 *
 * Talks to the keyboard through a transport (WebHID or the local bridge) and
 * keeps a working copy of every layer so nothing reaches the hardware until
 * the user applies it.
 */
import * as P from '../protocol.js';
import {
  decodeKey, KEY_CATALOG, MODIFIER_BITS, MEDIA_KEYS, MOUSE_BUTTONS, POWER_KEYS,
  ADVANCED_KEYS, WEBCODE_TO_USAGE, KEY_TYPES, basicEntry,
} from '../keys.js';
import { WebHidTransport, BridgeTransport } from './transport.js';
import { buildBoard, renderBoard, vendorBoard } from './keyboard.js';
import { lightingEffects } from '../effects.js';
import { sampleKeys } from '../art.js';
import { buildField } from './games/board.js';
import { SnakeGame } from './games/snake.js';
import { LightsOut } from './games/lights-out.js';
import { MemoryGame } from './games/memory.js';
import { ReactionGame } from './games/reaction.js';

const $ = selector => document.querySelector(selector);
const $$ = selector => Array.from(document.querySelectorAll(selector));

/** True when the app is served from the user's own machine, not from Pages. */
const isLocalPage = ['localhost', '127.0.0.1'].includes(location.hostname);

const state = {
  transport: null,
  device: null,
  layout: null,
  board: null,
  layers: [],
  factory: null,
  func: null,
  colors: null,
  lightMatrix: null,
  macros: [],
  layer: 0,
  slot: 0,
  profile: 0,
  colourIndex: new Map(),
  diff: false,
  pickerType: 'basic',
  modifiers: 0,
  selectedMacro: 0,
  search: '',
  dirty: { layers: new Set(), func: false, colors: false, macros: false },
  undo: [],
  redo: [],
};

const COLOR_PRESETS = [
  '#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#00c7be', '#30b0c7',
  '#007aff', '#5856d6', '#af52de', '#ff2d55', '#ffffff', '#8e8e93',
];

// ---------------------------------------------------------------- utilities

function toast(message, kind = '') {
  const el = document.createElement('div');
  el.className = `toast${kind ? ` is-${kind}` : ''}`;
  el.textContent = message;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), kind === 'error' ? 6000 : 3200);
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function setStatus(text, kind = '') {
  const chip = $('#device-chip');
  chip.classList.toggle('is-live', kind === 'live');
  chip.classList.toggle('is-error', kind === 'error');
  $('#device-chip-text').textContent = text;
  $('#d-status').textContent = text;
}

async function serialise(fn) {
  // one HID conversation at a time
  state.queue = state.queue || Promise.resolve();
  const next = state.queue.then(fn, fn);
  state.queue = next.catch(() => {});
  return next;
}

function snapshot(label) {
  state.undo.push({
    label,
    layers: state.layers.map(layer => layer.map(entry => ({ ...entry }))),
    func: state.func ? { ...state.func } : null,
    colors: state.colors ? state.colors.map(c => ({ ...c })) : null,
    macros: state.macros.map(macro => ({ ...macro, steps: macro.steps.map(s => ({ ...s })) })),
  });
  if (state.undo.length > 40) state.undo.shift();
  state.redo.length = 0;
}

function undo() {
  const entry = state.undo.pop();
  if (!entry) return toast('Nothing to undo.');
  state.redo.push({
    label: entry.label,
    layers: state.layers.map(layer => layer.map(e => ({ ...e }))),
    func: state.func ? { ...state.func } : null,
    colors: state.colors ? state.colors.map(c => ({ ...c })) : null,
    macros: state.macros.map(m => ({ ...m, steps: m.steps.map(s => ({ ...s })) })),
  });
  state.layers = entry.layers;
  state.func = entry.func;
  state.colors = entry.colors;
  state.macros = entry.macros;
  state.dirty.layers = new Set(state.layers.map((_, i) => i));
  renderAll();
}

function markLayerDirty(layer = state.layer) {
  state.dirty.layers.add(layer);
}

function markDirty(kind) {
  state.dirty[kind] = true;
}

// ---------------------------------------------------------------- connection

async function connect(transport) {
  try {
    setStatus('connecting…');
    const info = await transport.connect();
    state.transport = transport;
    state.device = info;
    setStatus('reading device…');
    showLoading(true);
    await readDevice();
    showLoading(false);
    setStatus(info.productName || 'connected', 'live');
    $('#d-product').textContent = info.productName || 'Keyboard';
    $('#d-transport').textContent = transport.mode === 'bridge' ? 'local bridge' : 'WebHID';
    toast(`Connected to ${info.productName || 'the keyboard'}`, 'ok');
    renderAll();
  } catch (error) {
    setStatus('disconnected', 'error');
    toast(error.message || 'Connection failed', 'error');
  }
}

async function readDevice() {
  const t = state.transport;
  await serialise(() => t.send(0, P.CMD.START_COMM, 0, [], 1));

  const basePayload = await serialise(() => t.send(0, P.CMD.GET_DEVICE_BASE_INFO, 34));
  state.base = P.parseBaseInfo(basePayload);

  const funcOffset = P.PROFILE_OFFSETS[state.profile] ?? 0;
  const funcPayload = await serialise(() => t.send(0, P.CMD.GET_FUNC_INFO, 56,
    [funcOffset & 0xff, (funcOffset >> 8) & 0xff, 0]));
  state.func = P.parseFuncInfo(funcPayload);

  state.layers = [];
  for (let layer = 0; layer < P.LAYERS; layer++) {
    const bytes = new Uint8Array(P.KEYMAP_BYTES);
    let cursor = 0;
    for (let offset = 0; offset < P.KEYMAP_BYTES; offset += P.CHUNK) {
      const len = Math.min(P.CHUNK, P.KEYMAP_BYTES - offset);
      const payload = await serialise(() => t.send(layer, P.CMD.GET_KEYMAP, len,
        [offset & 0xff, (offset >> 8) & 0xff, 0]));
      bytes.set(payload.subarray(0, len), cursor);
      cursor += len;
    }
    state.layers.push(P.parseKeymap(bytes));
  }

  const factoryBytes = new Uint8Array(P.KEYMAP_BYTES);
  let factoryCursor = 0;
  for (let offset = 0; offset < P.KEYMAP_BYTES; offset += P.CHUNK) {
    const len = Math.min(P.CHUNK, P.KEYMAP_BYTES - offset);
    const payload = await serialise(() => t.send(0, P.CMD.GET_DEFAULT_KEYMAP, len,
      [offset & 0xff, (offset >> 8) & 0xff, 0]));
    factoryBytes.set(payload.subarray(0, len), factoryCursor);
    factoryCursor += len;
  }
  state.factory = P.parseKeymap(factoryBytes);
  state.board = buildBoard(state.layout, state.factory);

  const colorBytes = new Uint8Array(P.COLOR_KEYS * 3);
  let colorCursor = 0;
  for (let offset = 0; offset < P.COLOR_KEYS * 3; offset += P.CHUNK) {
    const len = Math.min(P.CHUNK, P.COLOR_KEYS * 3 - offset);
    const payload = await serialise(() => t.send(0, P.CMD.GET_USER_KEY_COLORS, len,
      [offset & 0xff, (offset >> 8) & 0xff, 0]));
    colorBytes.set(payload.subarray(0, len), colorCursor);
    colorCursor += len;
  }
  state.colors = P.parseColors(colorBytes);

  const matrixBytes = new Uint8Array(P.LIGHT_MATRIX_SIZE);
  let matrixCursor = 0;
  for (let offset = 0; offset < P.LIGHT_MATRIX_SIZE; offset += P.CHUNK) {
    const len = Math.min(P.CHUNK, P.LIGHT_MATRIX_SIZE - offset);
    const payload = await serialise(() => t.send(0, P.CMD.GET_LIGHT_MATRIX, len,
      [offset & 0xff, (offset >> 8) & 0xff, 0]));
    matrixBytes.set(payload.subarray(0, len), matrixCursor);
    matrixCursor += len;
  }
  state.lightMatrix = P.parseLightMatrix(matrixBytes);
  state.colourIndex = P.colourIndexBySlot(state.lightMatrix);

  await serialise(() => t.send(0, P.CMD.STOP_COMM, 0, [], 2));

  state.dirty = { layers: new Set(), func: false, colors: false, macros: false };
  state.undo.length = 0;
  state.redo.length = 0;
}

// ---------------------------------------------------------------- rendering

function renderAll() {
  renderStatus();
  renderLayers();
  renderBoardPanel();
  renderInspector();
  renderLighting();
  renderGame();
  renderMacros();
  renderDevicePanel();
  renderDirty();
}

function showLoading(on) {
  const el = $('#board-loading');
  if (!el) return;
  el.hidden = !on;
  $('#board-loading-text').textContent = on ? 'Reading the keyboard…' : '';
}

function renderStatus() {
  $('#gate').hidden = !!state.transport;
  if (!state.base) return;
  $('#d-firmware').textContent = `0x${state.base.firmwareVer.toString(16).toUpperCase()}`;
  $('#d-protocol').textContent = `tag ${state.base.protocolTag} / ver ${state.base.protocolVer}`;
  $('#s-fw').textContent = `0x${state.base.firmwareVer.toString(16).toUpperCase()}`;
  $('#s-mode').textContent = state.func ? state.func.lightMode : '—';
  $('#s-keys').textContent = state.factory
    ? state.factory.filter(k => !(k.type === 0 && k.code1 === 0 && k.code2 === 0)).length
    : '—';
}

function renderLayers() {
  const host = $('#layer-switch');
  host.textContent = '';
  for (let i = 0; i < P.LAYERS; i++) {
    const btn = document.createElement('button');
    btn.className = 'layer-btn';
    btn.type = 'button';
    btn.setAttribute('aria-pressed', String(i === state.layer));
    btn.innerHTML = `${i}<span class="label">layer</span>`;
    if (state.dirty.layers.has(i)) {
      const dot = document.createElement('span');
      dot.className = 'dirty';
      btn.appendChild(dot);
    }
    btn.addEventListener('click', () => {
      state.layer = i;
      renderLayers();
      renderBoardPanel();
      renderInspector();
    });
    host.appendChild(btn);
  }
  $('#layer-note').textContent = `Editing layer ${state.layer}. Slots come from the keyboard's own keymap.`;
}

function renderBoardPanel() {
  if (!state.board) return;
  $('#board-title').textContent = `Layer ${state.layer}`;
  renderBoard($('#board'), state.board, {
    label: 'Keymap layout',
    layerKeys: state.layers[state.layer] || null,
    selectedSlot: state.slot,
    diffAgainst: state.diff ? state.factory : null,
    onSelect: selectSlot,
  });

  const extras = state.board.unmapped;
  $('#extra-slots-card').hidden = extras.length === 0;
  if (extras.length) {
    $('#extra-note').textContent =
      `${extras.length} keymap slots have no physical position in the layout. They are still assignable.`;
    const host = $('#extra-slots');
    host.textContent = '';
    for (const entry of extras) {
      const row = document.createElement('button');
      row.className = 'slot-row';
      row.type = 'button';
      const name = decodeKey(entry.type, entry.code1, entry.code2) || '(empty)';
      row.innerHTML = `<span class="idx">${entry.slot}</span><span class="name">${name}</span>`;
      row.addEventListener('click', () => selectSlot(entry.slot));
      host.appendChild(row);
    }
  }
  $('#board-note').textContent = state.board.keys.filter(k => k.slot === null).length
    ? 'Greyed keys are in the layout file but not in the keyboard keymap.'
    : 'Every layout key maps to a slot in the keyboard keymap.';
}

function selectSlot(slot) {
  state.slot = slot;
  const entry = state.layers[state.layer]?.[slot];
  state.modifiers = entry && entry.type === KEY_TYPES.BASIC ? entry.code1 : 0;
  renderBoardPanel();
  renderInspector();
}

function renderInspector() {
  const entry = state.layers[state.layer]?.[state.slot];
  if (!entry) return;
  const layoutKey = state.board?.keys.find(k => k.slot === state.slot);
  $('#inspector-title').textContent = layoutKey?.name || `Slot ${state.slot}`;
  $('#inspector-slot').textContent = `slot ${state.slot} · layer ${state.layer}`;
  $('#inspector-current').textContent = decodeKey(entry.type, entry.code1, entry.code2) || '(empty)';

  $$('#type-switch button').forEach(btn => {
    btn.setAttribute('aria-pressed', String(btn.dataset.type === state.pickerType));
  });

  const modHost = $('#modifier-toggles');
  modHost.textContent = '';
  if (state.pickerType === 'basic') {
    for (const mod of MODIFIER_BITS) {
      const btn = document.createElement('button');
      btn.className = 'mod';
      btn.type = 'button';
      btn.textContent = mod.name;
      btn.setAttribute('aria-pressed', String((state.modifiers & mod.bit) !== 0));
      btn.addEventListener('click', () => {
        state.modifiers ^= mod.bit;
        if (!state.modifiers && entry.type === KEY_TYPES.BASIC && entry.code2 === 0) {
          assign({ type: KEY_TYPES.EMPTY, code1: 0, code2: 0 });
        }
        renderInspector();
      });
      modHost.appendChild(btn);
    }
  }

  renderPicker();
}

function renderPicker() {
  const host = $('#picker-list');
  host.textContent = '';
  const search = state.search.trim().toLowerCase();

  const addGroup = (label, items) => {
    const filtered = items.filter(item => !search || item.label.toLowerCase().includes(search));
    if (!filtered.length) return;
    const head = document.createElement('div');
    head.className = 'keylist-group';
    head.textContent = label;
    host.appendChild(head);
    for (const item of filtered) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = item.label;
      btn.setAttribute('aria-pressed', String(state.pickerType === item.type && isActive(entryOf(), item)));
      btn.addEventListener('click', () => {
        assign(item.entry);
        renderInspector();
        renderBoardPanel();
        renderDirty();
      });
      host.appendChild(btn);
    }
  };

  const entryOf = () => state.layers[state.layer]?.[state.slot];

  if (state.pickerType === 'basic') {
    const groups = new Map();
    for (const key of KEY_CATALOG) {
      if (!groups.has(key.group)) groups.set(key.group, []);
      groups.get(key.group).push({
        type: 'basic',
        label: key.label,
        entry: basicEntry(key.usage, state.modifiers),
        usage: key.usage,
      });
    }
    for (const [group, items] of groups) addGroup(group, items);
  } else if (state.pickerType === 'media') {
    addGroup('Media', MEDIA_KEYS.map(k => ({
      type: 'media', label: k.name,
      entry: { type: KEY_TYPES.MEDIA, code1: k.code, code2: k.sub },
      code: k.code, sub: k.sub,
    })));
  } else if (state.pickerType === 'mouse') {
    addGroup('Mouse', MOUSE_BUTTONS.map(k => ({
      type: 'mouse', label: k.name,
      entry: { type: KEY_TYPES.MOUSE, code1: k.code, code2: 0 },
    })));
  } else if (state.pickerType === 'advanced') {
    addGroup('Advanced', ADVANCED_KEYS.map(k => ({
      type: 'advanced', label: k.name,
      entry: { type: KEY_TYPES.ICON, code1: k.code, code2: 0 },
    })));
  } else if (state.pickerType === 'power') {
    addGroup('Power', POWER_KEYS.map(k => ({
      type: 'power', label: k.name,
      entry: { type: KEY_TYPES.POWER, code1: k.code, code2: 0 },
    })));
  } else if (state.pickerType === 'macro') {
    addGroup('Macros', state.macros.map((macro, index) => ({
      type: 'macro', label: macro.name || `Macro ${index + 1}`,
      entry: {
        type: macro.replayCount > 1 ? KEY_TYPES.MACRO_REPLAY : KEY_TYPES.MACRO,
        code1: index,
        code2: macro.replayCount > 1 ? macro.replayCount : (macro.loopType || 0),
      },
    })));
  } else if (state.pickerType === 'fn') {
    addGroup('Special', [{
      type: 'fn', label: 'Fn',
      entry: { type: KEY_TYPES.FN, code1: 1, code2: 1 },
    }]);
  } else if (state.pickerType === 'clear') {
    addGroup('Clear', [{
      type: 'clear', label: 'Unassigned',
      entry: { type: KEY_TYPES.EMPTY, code1: 0, code2: 0 },
    }]);
  }

  if (!host.children.length) {
    const empty = document.createElement('div');
    empty.className = 'keylist-group';
    empty.textContent = 'nothing matches';
    host.appendChild(empty);
  }
}

function isActive(entry, item) {
  if (!entry) return false;
  if (item.type === 'basic') {
    return entry.type === KEY_TYPES.BASIC && entry.code1 === state.modifiers && entry.code2 === item.usage;
  }
  return entry.type === item.entry.type && entry.code1 === item.entry.code1 && entry.code2 === item.entry.code2;
}

function assign(entry) {
  snapshot('assign key');
  state.layers[state.layer][state.slot] = { ...entry };
  markLayerDirty();
  renderDirty();
}

function renderDirty() {
  const pending = [];
  if (state.dirty.layers.size) pending.push(`${state.dirty.layers.size} layer(s)`);
  if (state.dirty.func) pending.push('lighting');
  if (state.dirty.colors) pending.push('colours');
  if (state.dirty.macros) pending.push('macros');
  $('#dirty-text').textContent = pending.length ? `Pending: ${pending.join(', ')}.` : 'Nothing pending.';
  $('#apply-layer-btn').disabled = state.dirty.layers.size === 0;
  $('#revert-layer-btn').disabled = state.dirty.layers.size === 0;
}

function renderLighting() {
  const host = $('#effect-list');
  host.textContent = '';
  const effects = state.effects || [];
  for (const effect of effects) {
    const btn = document.createElement('button');
    btn.className = 'effect';
    btn.type = 'button';
    btn.setAttribute('aria-pressed', String(state.func?.lightMode === effect.value));
    btn.innerHTML = `<b>${effect.name}</b><span>value ${effect.value}</span>`;
    btn.addEventListener('click', () => {
      snapshot('set effect');
      state.func.lightMode = effect.value;
      markDirty('func');
      renderLighting();
      renderDirty();
    });
    host.appendChild(btn);
  }

  // The per-key board shows the physical layout even before the keyboard is
  // connected, so the shape of the picture is visible up front.
  renderColourBoard();

  if (!state.func) return;
  $('#light-profile').value = String(state.profile);
  $('#light-brightness').value = state.func.lightBrightness;
  $('#brightness-value').textContent = state.func.lightBrightness;
  $('#light-speed').value = state.func.lightSpeed;
  $('#speed-value').textContent = state.func.lightSpeed;
  $('#light-direction').value = String(state.func.lightDirection);
  const rgb = `#${[state.func.lightR, state.func.lightG, state.func.lightB]
    .map(v => v.toString(16).padStart(2, '0')).join('')}`;
  $('#light-color').value = rgb;
  $('#light-color-value').textContent = rgb.toUpperCase();
  $('#light-group').value = String(state.func.lightGroup ?? 0);
  $('#rainbow-mode').checked = state.func.mixColor === 1;
  $('#lock-win').checked = state.func.lockWin === 1;
  $('#wasd-mode').checked = state.func.keyWasd === 1;
  $('#six-key-mode').checked = state.func.sixKeyNoConflict === 1;
  $('#report-rate').value = String(state.func.reportRate ?? 0);
  $('#hit-rate').value = String(state.func.hitRate ?? 0);
  $('#hit-delay').value = String(state.func.hitDelay ?? 0);
}

/** Colour table index the firmware uses for a keymap slot. */
function colourIndexOf(slot) {
  return state.colourIndex?.get(slot);
}

function colourHexAt(index) {
  const color = state.colors?.[index];
  if (!color || (!color.r && !color.g && !color.b)) return null;
  return `#${[color.r, color.g, color.b].map(v => v.toString(16).padStart(2, '0')).join('')}`;
}

function renderColourBoard() {
  renderBoard($('#color-board'), state.board, {
    label: 'Per-key colour layout',
    colorFor: slot => colourHexAt(colourIndexOf(slot) ?? -1),
    onSelect: slot => {
      state.slot = slot;
      const picker = $('#color-picker');
      const hex = colourHexAt(colourIndexOf(slot) ?? -1);
      if (hex) picker.value = hex;
      paintSlot(slot, picker.value);
    },
  });
}

function paintSlot(slot, hex) {
  if (!state.colors) return;
  const index = colourIndexOf(slot);
  if (index === undefined) {
    toast('This key has no per-key colour slot in the board light matrix.', 'error');
    return;
  }
  const r = Math.min(P.RGB_MAX, parseInt(hex.slice(1, 3), 16));
  const g = Math.min(P.RGB_MAX, parseInt(hex.slice(3, 5), 16));
  const b = Math.min(P.RGB_MAX, parseInt(hex.slice(5, 7), 16));
  state.colors[index] = { r, g, b };
  markDirty('colors');
  renderDirty();
  renderColourBoard();
}

// ---- image to per-key colours ---------------------------------------------

// The board's physical grid is the canvas: every key samples the image at its
// own position, so the picture lands on the keys in their real places.
const imageCanvas = document.createElement('canvas');
const imageContext = imageCanvas.getContext('2d', { willReadFrequently: true });
let lastImageFile = null;

async function loadColourImage(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    toast('That file is not an image.', 'error');
    return;
  }
  const board = state.board;
  if (!board) return;
  const unit = 40;
  const width = board.width || 25.5;
  const height = board.height || 6.25;
  imageCanvas.width = Math.round(width * unit);
  imageCanvas.height = Math.round(height * unit);
  imageContext.fillStyle = '#000';
  imageContext.fillRect(0, 0, imageCanvas.width, imageCanvas.height);

  const bitmap = await createImageBitmap(file);
  const fill = $('#colour-image-fit').value === 'fill';
  const scale = fill
    ? Math.max(imageCanvas.width / bitmap.width, imageCanvas.height / bitmap.height)
    : Math.min(imageCanvas.width / bitmap.width, imageCanvas.height / bitmap.height);
  const drawWidth = bitmap.width * scale;
  const drawHeight = bitmap.height * scale;
  imageContext.drawImage(bitmap,
    (imageCanvas.width - drawWidth) / 2,
    (imageCanvas.height - drawHeight) / 2,
    drawWidth, drawHeight);
  bitmap.close?.();

  const pixels = imageContext.getImageData(0, 0, imageCanvas.width, imageCanvas.height).data;
  if (!state.colors) {
    state.colors = new Array(P.COLOR_KEYS).fill(0).map(() => ({ r: 0, g: 0, b: 0 }));
  }
  const sample = (x, y) => {
    const px = Math.min(imageCanvas.width - 1, Math.floor(x * imageCanvas.width));
    const py = Math.min(imageCanvas.height - 1, Math.floor(y * imageCanvas.height));
    const at = (py * imageCanvas.width + px) * 4;
    return { r: pixels[at], g: pixels[at + 1], b: pixels[at + 2] };
  };
  const painted = [];
  for (const entry of sampleKeys(board.keys, width, height, sample)) {
    const index = state.colourIndex?.get(entry.key.slot);
    if (index === undefined) continue;
    state.colors[index] = { r: entry.r, g: entry.g, b: entry.b };
    painted.push(entry);
  }
  lastImageFile = file;
  $('#colour-image-name').textContent = `${file.name} · ${painted.length} keys`;
  markDirty('colors');
  renderDirty();
  renderColourBoard();
  toast(`Image mapped onto ${painted.length} keys. Push it to the board with Apply colours.`, 'ok');
}

// ---- games ----------------------------------------------------------------

const GAMES = {
  snake: {
    title: 'Snake',
    create: field => new SnakeGame(field),
    speed: true,
    pad: true,
    interval: 150,
    hint: 'Arrow keys or WASD steer it.',
  },
  lights: {
    title: 'Lights Out',
    create: field => new LightsOut(field),
    speed: false,
    pad: false,
    interval: 400,
    hint: 'Press a key to toggle it and its neighbours.',
  },
  memory: {
    title: 'Memory',
    create: field => new MemoryGame(field),
    speed: true,
    pad: false,
    interval: 420,
    hint: 'Watch the sequence, then repeat it.',
  },
  reaction: {
    title: 'Reaction',
    create: field => new ReactionGame(field),
    speed: false,
    pad: false,
    interval: 50,
    hint: 'Hit the key as soon as it lights up.',
  },
};

const GAME_KEYS = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  w: 'up', s: 'down', a: 'left', d: 'right',
  W: 'up', S: 'down', A: 'left', D: 'right',
};

let game = null;
let gameTimer = null;
let gameRestore = null;
let currentGame = 'snake';

/** The game-over signal: the whole board red, blinking. */
const GAME_OVER_COLOUR = '#ff0000';
/** How many times the board blinks when a game ends. */
const FLASH_BLINKS = 3;
/** How long each half of a blink lasts. */
const FLASH_PHASE_MS = 350;
/** The phases a game ends in: the snake and memory die, lights out is solved. */
const GAME_END_PHASES = new Set(['over', 'solved']);
let gameFinished = false;
let flashOn = false;

/** The keys the games may use: only the ones the firmware gives a colour. */
function gameField() {
  if (!state.board) return null;
  const keys = state.board.keys.filter(key =>
    key.slot !== null && state.colourIndex?.has(key.slot));
  return keys.length ? buildField(keys) : null;
}

function gameHexToRgb(hex) {
  const value = parseInt(hex.slice(1), 16);
  return {
    r: Math.min(P.RGB_MAX, (value >> 16) & 0xff),
    g: Math.min(P.RGB_MAX, (value >> 8) & 0xff),
    b: Math.min(P.RGB_MAX, value & 0xff),
  };
}

/** The colour table the game wants: whatever it lit, everything else dark. */
function gameColours() {
  const colours = new Array(P.COLOR_KEYS).fill(0).map(() => ({ r: 0, g: 0, b: 0 }));
  if (!game) return colours;
  if (gameFinished) {
    // The game is over: every key red, blinking, so the board says so.
    if (flashOn) {
      for (let i = 0; i < colours.length; i++) colours[i] = { r: P.RGB_MAX, g: 0, b: 0 };
    }
    return colours;
  }
  for (const [key, hex] of game.paint()) {
    const index = state.colourIndex?.get(key.slot);
    if (index === undefined) continue;
    colours[index] = gameHexToRgb(hex);
  }
  return colours;
}

function renderGame() {
  if (!state.board) return;
  const lit = game ? game.paint() : new Map();
  renderBoard($('#game-board'), state.board, {
    label: 'Game',
    colorFor: slot => {
      if (gameFinished) {
        // Only the keys the firmware can light: the rest have no slot.
        return flashOn && state.colourIndex?.has(slot) ? GAME_OVER_COLOUR : null;
      }
      for (const [key, hex] of lit) if (key.slot === slot) return hex;
      return null;
    },
  });
}

function updateGameInfo() {
  if (!game) return;
  const info = game.info();
  $('#game-score-label').textContent = info.label;
  $('#game-score').textContent = `${info.score}${info.unit || ''}`;
  $('#game-status').textContent = info.text;
  if (gameFinished) {
    $('#game-hint').textContent = 'The board is flashing red: the game is over.';
  }
}

/** Put the board into the per-key mode, which is where the games live. */
async function ensureCustomMode() {
  if (!state.transport || !state.func) return;
  if (state.func.lightMode === P.MODE_CUSTOM) return;
  const profile = state.profile;
  const offset = P.PROFILE_OFFSETS[profile] ?? 0;
  const block = P.buildFuncInfo({
    profile,
    lightMode: P.MODE_CUSTOM,
    lightBrightness: state.func.lightBrightness,
    lightSpeed: state.func.lightSpeed,
    lightDirection: state.func.lightDirection,
    lightR: state.func.lightR,
    lightG: state.func.lightG,
    lightB: state.func.lightB,
  }, state.func.raw);
  // The whole conversation is one queue entry: a sequence that interleaves
  // with another one leaves the keyboard in a half-written state.
  await serialise(async () => {
    await state.transport.send(0, P.CMD.START_COMM, 0, [], 1);
    await sleep(12);
    await state.transport.send(0, P.CMD.SET_FUNC_INFO, 56,
      [offset & 0xff, (offset >> 8) & 0xff, 0, ...block]);
    await sleep(12);
    await state.transport.send(0, P.CMD.STOP_COMM, 0, [], 2);
  });
  state.func.lightMode = P.MODE_CUSTOM;
}

async function writeColourTable(colours) {
  const bytes = P.serializeColors(colours);
  await serialise(async () => {
    await state.transport.send(0, P.CMD.START_COMM, 0, [], 1);
    await sleep(12);
    for (const chunk of P.chunked(bytes)) {
      await state.transport.send(0, P.CMD.SET_USER_KEY_COLORS, chunk.length,
        [chunk.offset & 0xff, (chunk.offset >> 8) & 0xff, 0, ...chunk.bytes]);
    }
    await sleep(12);
    await state.transport.send(0, P.CMD.STOP_COMM, 0, [], 2);
  });
}

async function gameTick() {
  if (!game) return;
  game.tick();
  renderGame();
  updateGameInfo();
  if (GAME_END_PHASES.has(game.phase)) {
    // The game is over: flash the board, then hand it back to the lighting.
    gameFinished = true;
    updateGameInfo();
    await flashGameOver();
    await stopGame();
    return;
  }
  if (state.transport) await writeColourTable(gameColours());
  scheduleGame();
}

/**
 * The game-over signal: the whole board red, blinking three times.
 *
 * It runs on its own clock, not on the game's, so the pulses are the same
 * length whatever the game's speed is, and it stops the game while it runs
 * so nothing else writes the table.
 */
async function flashGameOver() {
  clearTimeout(gameTimer);
  gameTimer = null;
  for (let blink = 0; blink < FLASH_BLINKS; blink++) {
    for (const on of [true, false]) {
      flashOn = on;
      renderGame();
      if (state.transport) await writeColourTable(gameColours());
      await sleep(FLASH_PHASE_MS);
    }
  }
  flashOn = false;
}

function scheduleGame() {
  clearTimeout(gameTimer);
  gameTimer = setTimeout(gameTick, Number($('#game-speed').value) || 150);
}

/** Read the lighting settings of the current profile straight from the keyboard. */
async function readFuncInfo() {
  const offset = P.PROFILE_OFFSETS[state.profile] ?? 0;
  const payload = await serialise(() => state.transport.send(0, P.CMD.GET_FUNC_INFO, 56,
    [offset & 0xff, (offset >> 8) & 0xff, 0]));
  return P.parseFuncInfo(payload);
}

async function startGame() {
  if (!state.transport) return toast('Connect the keyboard first.', 'error');
  const field = gameField();
  if (!field) return toast('The keyboard has no colour slots to play on.', 'error');
  // What the keyboard has right now is what has to come back when the game
  // stops, so ask it rather than trusting the copy the app holds.
  state.func = await readFuncInfo();
  gameRestore = { ...state.func };
  game = GAMES[currentGame].create(field);
  game.start();
  gameFinished = false;
  flashOn = false;
  $('#game-hint').textContent = GAMES[currentGame].hint;
  await ensureCustomMode();
  $('#game-start').disabled = true;
  renderGame();
  updateGameInfo();
  if (state.transport) await writeColourTable(gameColours());
  scheduleGame();
}

async function stopGame() {
  clearTimeout(gameTimer);
  gameTimer = null;
  const wasRunning = !!game;
  game = null;
  gameFinished = false;
  flashOn = false;
  $('#game-start').disabled = false;
  $('#game-hint').textContent = GAMES[currentGame].hint;
  if (!wasRunning) return;
  if (state.transport) {
    await writeColourTable(state.colors);
    if (gameRestore) {
      const current = state.func;
      state.func = { ...current, ...gameRestore };
      await applyLighting();
      // Check the keyboard really took it, and write once more if it did not.
      const check = await readFuncInfo();
      if (check.lightMode !== gameRestore.lightMode) await applyLighting();
      state.func = current;
    }
  }
  renderGame();
}

/** Switch to another game, putting the board back first. */
async function selectGame(id) {
  if (!GAMES[id]) return;
  await stopGame();
  currentGame = id;
  for (const button of document.querySelectorAll('.game-picker [data-game]')) {
    button.setAttribute('aria-pressed', String(button.dataset.game === id));
  }
  $('#game-speed-row').hidden = !GAMES[id].speed;
  $('#game-pad').hidden = !GAMES[id].pad;
  $('#game-speed').value = String(GAMES[id].interval);
  $('#game-speed-value').textContent = `${GAMES[id].interval} ms`;
  $('#game-hint').textContent = GAMES[id].hint;
  $('#game-status').textContent = GAMES[id].hint;
  renderGame();
}

/** The field key a browser key press lands on, if any. */
function fieldKeyForCode(code) {
  const usage = WEBCODE_TO_USAGE[code];
  if (usage === undefined || !game) return null;
  return game.field.keys.find(key => key.usage === usage) || null;
}

function renderMacros() {
  const host = $('#macro-list');
  host.textContent = '';
  if (!state.macros.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No macros yet. Create one, add steps, then push it to the keyboard.';
    host.appendChild(empty);
  }
  state.macros.forEach((macro, index) => {
    const btn = document.createElement('button');
    btn.className = 'macro-item';
    btn.type = 'button';
    btn.setAttribute('aria-pressed', String(index === state.selectedMacro));
    const loop = ['n times', 'while held', 'until same key'][macro.loopType || 0];
    btn.innerHTML = `<span class="name">${macro.name || `Macro ${index + 1}`}</span>
      <span class="tag">${macro.steps.length} steps · ${loop} · x${macro.replayCount}</span>`;
    btn.addEventListener('click', () => {
      state.selectedMacro = index;
      renderMacros();
    });
    host.appendChild(btn);
  });

  const macro = state.macros[state.selectedMacro];
  const stepsHost = $('#macro-steps');
  stepsHost.textContent = '';
  saveLocalMacros();
  if (!macro) {
    $('#macro-title').textContent = 'Steps';
    $('#macro-name').value = '';
    $('#macro-note').textContent = 'Macros live in this browser and are pushed to the keyboard on demand.';
    return;
  }
  $('#macro-title').textContent = macro.name || `Macro ${state.selectedMacro + 1}`;
  $('#macro-name').value = macro.name || '';
  $('#macro-replay-input').value = macro.replayCount;
  $('#macro-loop-type').value = String(macro.loopType || 0);
  $('#macro-replay').textContent = `replay x${macro.replayCount}`;

  macro.steps.forEach((step, index) => {
    const row = document.createElement('div');
    row.className = 'step';

    const kind = document.createElement('select');
    for (const [value, label] of [['key', 'key'], ['mouse', 'mouse'], ['delay', 'delay']]) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      if (step.kind === value) opt.selected = true;
      kind.appendChild(opt);
    }
    kind.addEventListener('change', () => {
      snapshot('edit step');
      step.kind = kind.value;
      if (step.kind === 'mouse' && !step.button) step.button = 'left';
      if (step.kind === 'delay' && !step.time) step.time = 50;
      markDirty('macros');
      renderMacros();
    });

    const value = document.createElement('input');
    value.type = 'text';
    if (step.kind === 'key') {
      value.value = step.label || '';
      value.placeholder = 'key name';
      value.addEventListener('change', () => {
        snapshot('edit step');
        step.label = value.value;
        step.code = lookupUsage(value.value);
        markDirty('macros');
      });
    } else if (step.kind === 'mouse') {
      value.innerHTML = MOUSE_BUTTONS
        .map(b => `<option value="${b.code}">${b.name}</option>`).join('');
      value.value = String(step.buttonCode || 1);
      value.addEventListener('change', () => {
        snapshot('edit step');
        step.buttonCode = Number(value.value);
        step.button = MOUSE_BUTTONS.find(b => b.code === Number(value.value))?.name || 'left';
        markDirty('macros');
      });
    } else {
      value.type = 'number';
      value.value = step.time || 50;
      value.addEventListener('change', () => {
        snapshot('edit step');
        step.time = Number(value.value);
        markDirty('macros');
      });
    }

    const time = document.createElement('input');
    time.type = 'number';
    time.value = step.time ?? 50;
    time.title = 'Delay before the step (ms)';
    time.addEventListener('change', () => {
      snapshot('edit step');
      step.time = Number(time.value);
      markDirty('macros');
    });

    const mode = document.createElement('select');
    mode.title = 'How the key is pressed';
    for (const [value, label] of [['tap', 'tap'], ['hold', 'hold'], ['release', 'release']]) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      if ((step.mode || 'tap') === value) opt.selected = true;
      mode.append(opt);
    }
    mode.addEventListener('change', () => {
      snapshot('edit step');
      step.mode = mode.value;
      markDirty('macros');
    });

    const remove = document.createElement('button');
    remove.className = 'btn btn-sm btn-ghost';
    remove.type = 'button';
    remove.textContent = '×';
    remove.addEventListener('click', () => {
      snapshot('delete step');
      macro.steps.splice(index, 1);
      markDirty('macros');
      renderMacros();
    });

    row.append(kind, value, time, mode, remove);
    stepsHost.appendChild(row);
  });
}

function lookupUsage(label) {
  const found = KEY_CATALOG.find(k => k.label.toLowerCase() === String(label).toLowerCase());
  return found ? found.usage : 0;
}

// ---- macro recorder -------------------------------------------------------

let recording = false;

function startRecording() {
  recording = true;
  const btn = $('#record-btn');
  btn.textContent = 'Stop recording';
  btn.classList.add('btn-primary');
  window.addEventListener('keydown', onRecordKey, true);
  toast('Recording: press keys to add steps, press again to stop', 'ok');
}

function stopRecording() {
  recording = false;
  const btn = $('#record-btn');
  btn.textContent = 'Record';
  btn.classList.remove('btn-primary');
  window.removeEventListener('keydown', onRecordKey, true);
  markDirty('macros');
  renderMacros();
}

function onRecordKey(event) {
  if (!recording) return;
  if (event.repeat) return;                       // holding a key is one step
  if (event.target && /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) return;
  const usage = WEBCODE_TO_USAGE[event.code];
  if (usage === undefined) return;
  event.preventDefault();
  event.stopPropagation();
  const macro = state.macros[state.selectedMacro];
  if (!macro) return;
  // One press is one step. The firmware still gets a press and a release:
  // the encoder expands a tap into both.
  macro.steps.push({ kind: 'key', code: usage, label: event.code, time: 30, mode: 'tap' });
  markDirty('macros');
  renderMacros();
}

function renderDevicePanel() {
  const kv = $('#report-kv');
  kv.textContent = '';
  if (!state.base) return;
  const rows = [
    ['Vendor', `0x${state.base.vendorId.toString(16).toUpperCase()}`],
    ['Product', `0x${state.base.productId.toString(16).toUpperCase()}`],
    ['Firmware', `0x${state.base.firmwareVer.toString(16).toUpperCase()}`],
    ['Protocol tag', state.base.protocolTag],
    ['Protocol ver', state.base.protocolVer],
    ['Keyboard id', state.base.keyboardId],
    ['Profile', state.base.profile],
    ['Report id', P.REPORT_ID],
    ['Collection', `0x${P.USAGE_PAGE.toString(16).toUpperCase()}/0x${P.USAGE.toString(16).toUpperCase()}`],
    ['Assigned slots', state.factory
      ? state.factory.filter(k => !(k.type === 0 && k.code1 === 0 && k.code2 === 0)).length : 0],
  ];
  for (const [label, value] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = String(value);
    kv.append(dt, dd);
  }
}

// ------------------------------------------------------------------- writes

async function applyLayer() {
  if (!state.transport) return toast('Not connected.', 'error');
  const layer = state.layer;
  try {
    await serialise(() => state.transport.send(0, P.CMD.START_COMM, 0, [], 1));
    const bytes = P.serializeKeymap(state.layers[layer]);
    for (const chunk of P.chunked(bytes)) {
      await serialise(() => state.transport.send(0, P.CMD.SET_KEYMAP, chunk.length,
        [chunk.offset & 0xff, (chunk.offset >> 8) & 0xff, layer, ...chunk.bytes]));
    }
    await serialise(() => state.transport.send(0, P.CMD.STOP_COMM, 0, [], 2));
    state.dirty.layers.delete(layer);
    renderDirty();
    renderLayers();
    toast(`Layer ${layer} written to the keyboard`, 'ok');
  } catch (error) {
    toast(`Write failed: ${error.message}`, 'error');
  }
}

async function revertLayer() {
  state.layers[state.layer] = state.factory.map(entry => ({ ...entry }));
  state.dirty.layers.delete(state.layer);
  renderAll();
}

async function applyLighting() {
  if (!state.transport || !state.func) return toast('Not connected.', 'error');
  try {
    const profile = state.profile;
    const offset = P.PROFILE_OFFSETS[profile] ?? 0;
    const block = P.buildFuncInfo({
      profile,
      lightMode: state.func.lightMode,
      lightBrightness: state.func.lightBrightness,
      lightSpeed: state.func.lightSpeed,
      lightDirection: state.func.lightDirection,
      mixColor: state.func.mixColor,
      lightR: state.func.lightR,
      lightG: state.func.lightG,
      lightB: state.func.lightB,
      lightGroup: state.func.lightGroup,
      keyWasd: state.func.keyWasd,
      sixKeyNoConflict: state.func.sixKeyNoConflict,
      lockWin: state.func.lockWin,
      reportRate: state.func.reportRate,
      hitRate: state.func.hitRate,
      hitDelay: state.func.hitDelay,
    }, state.func.raw);
    await serialise(async () => {
      await state.transport.send(0, P.CMD.START_COMM, 0, [], 1);
      await sleep(12);
      await state.transport.send(0, P.CMD.SET_FUNC_INFO, 56,
        [offset & 0xff, (offset >> 8) & 0xff, 0, ...block]);
      await sleep(12);
      await state.transport.send(0, P.CMD.STOP_COMM, 0, [], 2);
    });
    state.dirty.func = false;
    renderDirty();
    toast(`Lighting written to profile ${profile + 1}`, 'ok');
  } catch (error) {
    toast(`Write failed: ${error.message}`, 'error');
  }
}

async function applyColors({ switchMode = null } = {}) {
  if (!state.transport || !state.colors) return toast('Not connected.', 'error');
  const withMode = switchMode === null ? $('#custom-mode-toggle').checked : switchMode;
  try {
    const bytes = P.serializeColors(state.colors);
    await serialise(() => state.transport.send(0, P.CMD.START_COMM, 0, [], 1));
    await sleep(12);
    for (const chunk of P.chunked(bytes)) {
      await serialise(() => state.transport.send(0, P.CMD.SET_USER_KEY_COLORS, chunk.length,
        [chunk.offset & 0xff, (chunk.offset >> 8) & 0xff, 0, ...chunk.bytes]));
    }
    await sleep(12);
    if (withMode && state.func) {
      // per-key colours are only shown while the board runs the custom mode
      const profile = state.profile;
      const offset = P.PROFILE_OFFSETS[profile] ?? 0;
      const block = P.buildFuncInfo({
        profile,
        lightMode: P.MODE_CUSTOM,
        lightBrightness: state.func.lightBrightness,
        lightSpeed: state.func.lightSpeed,
        lightDirection: state.func.lightDirection,
        lightR: state.func.lightR,
        lightG: state.func.lightG,
        lightB: state.func.lightB,
      }, state.func.raw);
      await serialise(() => state.transport.send(0, P.CMD.SET_FUNC_INFO, 56,
        [offset & 0xff, (offset >> 8) & 0xff, 0, ...block]));
      state.func.lightMode = P.MODE_CUSTOM;
      state.dirty.func = false;
    }
    await serialise(() => state.transport.send(0, P.CMD.STOP_COMM, 0, [], 2));
    state.dirty.colors = false;
    renderDirty();
    renderLighting();
    toast('Per-key colours written', 'ok');
  } catch (error) {
    toast(`Write failed: ${error.message}`, 'error');
  }
}

async function pushMacros() {
  if (!state.transport) return toast('Not connected.', 'error');
  if (!state.macros.length) return toast('No macros to push.', 'error');
  try {
    const { bytes, length } = P.buildMacroBlock(state.macros);
    const count = Math.max(1, Math.ceil(length / P.CHUNK));
    await serialise(() => state.transport.send(0, P.CMD.START_COMM, 0, [], 1));
    for (let i = 0; i < count; i++) {
      const offset = i * P.CHUNK;
      const chunk = bytes.subarray(offset, offset + P.CHUNK);
      const checksum = P.sum8(chunk);
      const len = i === count - 1 ? (length % P.CHUNK || P.CHUNK) : P.CHUNK;
      await serialise(() => state.transport.send(0, P.CMD.SET_MACRO_V2, len,
        [offset & 0xff, (offset >> 8) & 0xff, checksum, ...chunk]));
    }
    await serialise(() => state.transport.send(0, P.CMD.STOP_COMM, 0, [], 2));
    state.dirty.macros = false;
    renderDirty();
    toast(`${state.macros.length} macro(s) pushed`, 'ok');
  } catch (error) {
    toast(`Push failed: ${error.message}`, 'error');
  }
}

async function factoryReset() {
  if (!state.transport) return toast('Not connected.', 'error');
  if (!confirm('Factory reset clears every layer, colour and macro on the keyboard. Continue?')) return;
  try {
    await serialise(() => state.transport.send(0, P.CMD.START_COMM, 0, [], 1));
    await serialise(() => state.transport.send(0, P.CMD.RESTORE_FACTORY_SETTINGS, 0, [0, 0]));
    await serialise(() => state.transport.send(0, P.CMD.STOP_COMM, 0, [], 2));
    toast('Factory reset sent, re-reading the keyboard', 'ok');
    await readDevice();
    renderAll();
  } catch (error) {
    toast(`Reset failed: ${error.message}`, 'error');
  }
}

// ----------------------------------------------------------------- profiles

function exportProfile() {
  const profile = {
    format: 'ronin-config-profile',
    version: 1,
    exportedAt: new Date().toISOString(),
    device: state.base ? {
      vendorId: state.base.vendorId,
      productId: state.base.productId,
      firmwareVer: state.base.firmwareVer,
    } : null,
    layers: state.layers.map(layer => layer.map(e => [e.type, e.code1, e.code2])),
    func: state.func ? {
      lightMode: state.func.lightMode,
      lightBrightness: state.func.lightBrightness,
      lightSpeed: state.func.lightSpeed,
      lightDirection: state.func.lightDirection,
      lightR: state.func.lightR,
      lightG: state.func.lightG,
      lightB: state.func.lightB,
      lightGroup: state.func.lightGroup,
      keyWasd: state.func.keyWasd,
      lockWin: state.func.lockWin,
    } : null,
    colors: state.colors?.map(c => [c.r, c.g, c.b]) || [],
    macros: state.macros,
  };
  const blob = new Blob([JSON.stringify(profile, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `ronin-profile-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
  toast('Profile exported', 'ok');
}

async function importProfile(file) {
  try {
    const profile = JSON.parse(await file.text());
    if (!profile.layers) throw new Error('Not a Ronin profile.');
    snapshot('import profile');
    state.layers = profile.layers.map(layer => layer.map(e => ({
      type: e[0], code1: e[1], code2: e[2],
    })));
    if (profile.func) Object.assign(state.func, profile.func);
    if (profile.colors?.length) {
      state.colors = profile.colors.map(c => ({ r: c[0], g: c[1], b: c[2] }));
    }
    if (profile.macros) state.macros = profile.macros;
    state.dirty.layers = new Set(state.layers.map((_, i) => i));
    state.dirty.func = true;
    state.dirty.colors = true;
    state.dirty.macros = true;
    renderAll();
    toast('Profile imported, review and apply', 'ok');
  } catch (error) {
    toast(`Import failed: ${error.message}`, 'error');
  }
}

// ------------------------------------------------------------------ console

function consoleLog(kind, text) {
  const out = $('#console-out');
  const line = document.createElement('div');
  line.className = kind;
  line.textContent = text;
  out.appendChild(line);
  out.scrollTop = out.scrollHeight;
}

async function consoleSend() {
  if (!state.transport) return toast('Not connected.', 'error');
  const cmd = parseInt($('#console-cmd').value, 16);
  const len = parseInt($('#console-len').value, 10) || 0;
  const args = $('#console-args').value.split(',').map(v => parseInt(v.trim(), 16)).filter(v => !Number.isNaN(v));
  const frame = P.buildFrame(0, cmd, len, args);
  consoleLog('cmd', `>> ${[...frame].map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
  try {
    const payload = await serialise(() => state.transport.send(0, cmd, len, args));
    consoleLog('ok', `<< ${[...payload].map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
  } catch (error) {
    consoleLog('err', `!! ${error.message}`);
  }
}

// -------------------------------------------------------------------- wiring

function wire() {
  $$('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      $$('.tab').forEach(t => t.setAttribute('aria-selected', String(t === tab)));
      $$('.panel').forEach(panel => {
        panel.classList.toggle('is-active', panel.dataset.panel === tab.dataset.panel);
      });
      // the board scales to its container, so re-measure once the panel is visible
      requestAnimationFrame(() => { renderBoardPanel(); renderLighting(); });
    });
  });

  $('#connect-btn').addEventListener('click', () => connect(new WebHidTransport()));
  $('#bridge-btn').addEventListener('click', () => connect(new BridgeTransport()));
  $('#gate-connect').addEventListener('click', () => connect(new WebHidTransport()));
  $('#gate-bridge').addEventListener('click', () => connect(new BridgeTransport()));
  $('#refresh-btn').addEventListener('click', async () => {
    try {
      await readDevice();
      renderAll();
      toast('Re-read from the keyboard', 'ok');
    } catch (error) {
      toast(`Read failed: ${error.message}`, 'error');
    }
  });

  $('#diff-toggle').addEventListener('change', event => {
    state.diff = event.target.checked;
    renderBoardPanel();
  });

  $('#apply-layer-btn').addEventListener('click', applyLayer);
  $('#revert-layer-btn').addEventListener('click', revertLayer);
  $('#apply-lighting-btn').addEventListener('click', applyLighting);
  $('#apply-colors-btn').addEventListener('click', applyColors);
  $('#apply-macros-btn').addEventListener('click', pushMacros);
  $('#reset-btn').addEventListener('click', factoryReset);

  $('#export-btn').addEventListener('click', exportProfile);
  $('#export-2-btn').addEventListener('click', exportProfile);
  $('#import-btn').addEventListener('click', () => $('#import-file').click());
  $('#import-2-btn').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', event => {
    const file = event.target.files?.[0];
    if (file) importProfile(file);
    event.target.value = '';
  });

  $$('#type-switch button').forEach(btn => {
    btn.addEventListener('click', () => {
      state.pickerType = btn.dataset.type;
      state.search = '';
      $('#picker-search').value = '';
      renderInspector();
    });
  });

  $('#picker-search').addEventListener('input', event => {
    state.search = event.target.value;
    renderPicker();
  });

  $('#clear-key-btn').addEventListener('click', () => {
    assign({ type: KEY_TYPES.EMPTY, code1: 0, code2: 0 });
    renderInspector();
    renderBoardPanel();
  });

  $('#light-profile').addEventListener('change', async event => {
    state.profile = Number(event.target.value);
    if (!state.transport) return;
    try {
      const offset = P.PROFILE_OFFSETS[state.profile] ?? 0;
      const payload = await serialise(() => state.transport.send(0, P.CMD.GET_FUNC_INFO, 56,
        [offset & 0xff, (offset >> 8) & 0xff, 0]));
      state.func = P.parseFuncInfo(payload);
      renderLighting();
      renderDirty();
      toast(`Profile ${state.profile + 1} loaded`, 'ok');
    } catch (error) {
      toast(`Profile read failed: ${error.message}`, 'error');
    }
  });

  $('#light-brightness').addEventListener('input', event => {
    state.func.lightBrightness = Number(event.target.value);
    $('#brightness-value').textContent = event.target.value;
    markDirty('func');
    renderDirty();
  });
  $('#light-speed').addEventListener('input', event => {
    state.func.lightSpeed = Number(event.target.value);
    $('#speed-value').textContent = event.target.value;
    markDirty('func');
    renderDirty();
  });
  $('#light-direction').addEventListener('change', event => {
    state.func.lightDirection = Number(event.target.value);
    markDirty('func');
  });
  $('#light-color').addEventListener('input', event => {
    const hex = event.target.value;
    state.func.lightR = parseInt(hex.slice(1, 3), 16);
    state.func.lightG = parseInt(hex.slice(3, 5), 16);
    state.func.lightB = parseInt(hex.slice(5, 7), 16);
    $('#light-color-value').textContent = hex.toUpperCase();
    markDirty('func');
  });
  $('#light-group').addEventListener('change', event => {
    state.func.lightGroup = Number(event.target.value);
    markDirty('func');
  });
  $('#lock-win').addEventListener('change', event => {
    state.func.lockWin = event.target.checked ? 1 : 0;
    markDirty('func');
  });
  $('#wasd-mode').addEventListener('change', event => {
    state.func.keyWasd = event.target.checked ? 1 : 0;
    markDirty('func');
  });
  $('#rainbow-mode').addEventListener('change', event => {
    state.func.mixColor = event.target.checked ? 1 : 0;
    markDirty('func');
  });
  $('#six-key-mode').addEventListener('change', event => {
    state.func.sixKeyNoConflict = event.target.checked ? 1 : 0;
    markDirty('func');
  });
  $('#report-rate').addEventListener('change', event => {
    state.func.reportRate = Number(event.target.value);
    markDirty('func');
  });
  $('#hit-rate').addEventListener('change', event => {
    state.func.hitRate = Number(event.target.value);
    markDirty('func');
  });
  $('#hit-delay').addEventListener('change', event => {
    state.func.hitDelay = Number(event.target.value);
    markDirty('func');
  });

  $('#clear-colors-btn').addEventListener('click', async () => {
    if (!state.colors) return;
    snapshot('clear colours');
    state.colors = state.colors.map(() => ({ r: 0, g: 0, b: 0 }));
    markDirty('colors');
    renderColourBoard();
    renderDirty();
    if (state.transport) {
      // clearing is an explicit action, so write it straight to the board and
      // leave the lighting effect alone
      await applyColors({ switchMode: false });
    } else {
      toast('Colour table cleared. Apply colours to write it to the keyboard.');
    }
  });

  const picker = $('#color-picker');
  picker.addEventListener('input', () => {
    $('#color-readout').textContent = picker.value.toUpperCase();
  });
  picker.addEventListener('change', () => paintSlot(state.slot, picker.value));

  $('#colour-image').addEventListener('change', event => {
    const file = event.target.files?.[0];
    if (file) loadColourImage(file);
  });
  $('#colour-image-fit').addEventListener('change', () => {
    if (lastImageFile) loadColourImage(lastImageFile);
  });

  $('#game-start').addEventListener('click', () => startGame());
  $('#game-new').addEventListener('click', () => startGame());
  $('#game-stop').addEventListener('click', () => stopGame());
  $('#game-speed').addEventListener('input', event => {
    $('#game-speed-value').textContent = `${event.target.value} ms`;
    if (game) scheduleGame();
  });
  for (const button of document.querySelectorAll('.game-picker [data-game]')) {
    button.addEventListener('click', () => selectGame(button.dataset.game));
  }
  for (const button of document.querySelectorAll('.game-pad [data-dir]')) {
    button.addEventListener('click', () => game?.steer(button.dataset.dir));
  }
  document.addEventListener('keydown', event => {
    if (!game) return;
    if (document.querySelector('.panel.is-active')?.dataset.panel !== 'game') return;
    if (GAMES[currentGame].pad) {
      const direction = GAME_KEYS[event.key];
      if (!direction) return;
      event.preventDefault();
      game.steer(direction);
      return;
    }
    const key = fieldKeyForCode(event.code);
    if (!key) return;
    event.preventDefault();
    game.press(key);
    renderGame();
    updateGameInfo();
    if (state.transport) writeColourTable(gameColours());
  });

  const presetHost = $('#color-presets');
  for (const color of COLOR_PRESETS) {
    const swatch = document.createElement('button');
    swatch.className = 'swatch';
    swatch.type = 'button';
    swatch.style.background = color;
    swatch.title = color;
    swatch.setAttribute('aria-label', `Colour ${color}`);
    swatch.addEventListener('click', () => {
      picker.value = color;
      $('#color-readout').textContent = color.toUpperCase();
      paintSlot(state.slot, color);
    });
    presetHost.appendChild(swatch);
  }

  $('#new-macro-btn').addEventListener('click', () => {
    snapshot('new macro');
    state.macros.push({ name: `Macro ${state.macros.length + 1}`, replayCount: 1, loopType: 0, steps: [] });
    state.selectedMacro = state.macros.length - 1;
    markDirty('macros');
    renderMacros();
    renderDirty();
  });
  $('#delete-macro-btn').addEventListener('click', () => {
    if (!state.macros[state.selectedMacro]) return;
    snapshot('delete macro');
    state.macros.splice(state.selectedMacro, 1);
    state.selectedMacro = Math.max(0, state.selectedMacro - 1);
    markDirty('macros');
    renderMacros();
    renderDirty();
  });
  $('#add-step-btn').addEventListener('click', () => {
    const macro = state.macros[state.selectedMacro];
    if (!macro) return toast('Create a macro first.', 'error');
    snapshot('add step');
    macro.steps.push({ kind: 'key', code: 0, label: '', time: 50, release: false });
    markDirty('macros');
    renderMacros();
  });
  $('#macro-name').addEventListener('change', event => {
    const macro = state.macros[state.selectedMacro];
    if (!macro) return;
    snapshot('rename macro');
    macro.name = event.target.value;
    markDirty('macros');
    renderMacros();
  });
  $('#macro-replay-input').addEventListener('change', event => {
    const macro = state.macros[state.selectedMacro];
    if (!macro) return;
    snapshot('replay count');
    macro.replayCount = Math.max(1, Number(event.target.value) || 1);
    markDirty('macros');
    renderMacros();
  });
  $('#macro-loop-type').addEventListener('change', event => {
    const macro = state.macros[state.selectedMacro];
    if (!macro) return;
    snapshot('loop type');
    macro.loopType = Number(event.target.value);
    markDirty('macros');
    renderMacros();
  });
  $('#record-btn').addEventListener('click', () => {
    if (recording) { stopRecording(); return; }
    if (!state.macros[state.selectedMacro]) return toast('Create a macro first.', 'error');
    startRecording();
  });

  $('#console-send').addEventListener('click', consoleSend);

  // the board scales to its container, so re-measure it when the window changes
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { renderBoardPanel(); renderLighting(); }, 150);
  });

  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) {
        const entry = state.redo.pop();
        if (entry) {
          state.undo.push(entry);
          state.layers = entry.layers;
          state.func = entry.func;
          state.colors = entry.colors;
          state.macros = entry.macros;
          renderAll();
        }
      } else {
        undo();
      }
    }
  });
}

/**
 * Show which build is loaded.
 *
 * A page left open across a deploy keeps the modules it loaded, so this
 * says whether what is on screen is what the repository holds now.
 */
async function showBuild() {
  try {
    const build = await fetch('../build.json', { cache: 'no-store' }).then(r => r.json());
    if (build.sha) $('#app-build').textContent = `0x320F:0x5055 · build ${build.sha}`;
  } catch {
    // Served by the local server, which has no build file.
  }
}

async function boot() {
  wire();
  const vendorLayout = await fetch('../layout/320f_5055_2.json').then(r => r.json());
  state.layout = vendorBoard(vendorLayout);
  state.effects = lightingEffects(vendorLayout.lighting?.backlight);
  state.board = buildBoard(state.layout, new Array(P.KEYMAP_SLOTS).fill({ type: 0, code1: 0, code2: 0 }));
  state.macros = loadLocalMacros() || state.macros;
  renderAll();
  showBuild();
  if (!isLocalPage) {
    // The local bridge speaks a plain WebSocket, and a page served over
    // HTTPS may not open one, so the bridge is only offered when the app
    // is served from the user's own machine.
    $('#gate-bridge').hidden = true;
    $('#bridge-btn').hidden = true;
    $('#gate-note').innerHTML =
      'Chrome and Edge reach the board directly over WebHID. This page is served from ' +
      'GitHub Pages, so the local bridge cannot be reached from it &mdash; open the app ' +
      'from your own machine (<code>npm run web</code>) to use another browser.';
  }
  if (!('hid' in navigator)) {
    toast(isLocalPage
      ? 'WebHID is unavailable here. Use the local bridge button.'
      : 'WebHID is unavailable here. Open the app from your own machine (npm run web).',
      'error');
  }
}

const MACRO_STORE = 'ronin.macros';

function loadLocalMacros() {
  try {
    const raw = localStorage.getItem(MACRO_STORE);
    return raw ? migrateMacros(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

/**
 * Older recordings stored a press and a release as two steps, which made one
 * key press show up twice. They are folded back into one step here.
 */
function migrateMacros(macros) {
  if (!Array.isArray(macros)) return macros;
  return macros.map(macro => {
    const steps = [];
    const legacy = macro.steps || [];
    for (let i = 0; i < legacy.length; i++) {
      const step = legacy[i];
      if (step.mode) { steps.push({ ...step }); continue; }
      const next = legacy[i + 1];
      if (step.release === false && next && next.release === true
          && next.kind === step.kind && next.code === step.code) {
        steps.push({ ...step, mode: 'tap' });
        i++;
        continue;
      }
      steps.push({ ...step, mode: step.release === true ? 'release' : 'hold' });
    }
    return { ...macro, steps };
  });
}

function saveLocalMacros() {
  try {
    localStorage.setItem(MACRO_STORE, JSON.stringify(state.macros));
  } catch { /* storage disabled */ }
}

boot();
