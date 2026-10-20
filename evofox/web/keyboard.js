/**
 * Board rendering: turns the vendor layout JSON plus the keyboard's own
 * factory keymap into a physical board, and paints it.
 */
import { decodeKey, MODIFIER_BITS } from '../keys.js';

export const UNIT = 40; // px per key unit

/** HID usage a keymap entry stands for, or null when it is not a plain key. */
function effectiveUsage(key) {
  if (key.type !== 32 && key.type !== 18) return null;
  if (key.code2) return key.code2;
  if (key.code1) {
    const modifier = MODIFIER_BITS.find(m => m.bit === key.code1);
    if (modifier) return modifier.hid;   // lone modifiers carry their HID code in code1
  }
  return null;
}

/** True when the entry carries no assignment at all. */
export function isEmptyEntry(key) {
  if (key.type === 0) return key.code1 === 0 && key.code2 === 0;
  if (key.type === 32 || key.type === 18) return key.code1 === 0 && key.code2 === 0;
  return false;
}

/**
 * The vendor's layout file describes the physical board: 79 keys on a
 * 19.56 x 6.5 unit grid, which is the compact 75% layout with the knob
 * column, not the generic keymap the firmware also carries. Turn it into the
 * shape buildBoard expects.
 */
export function vendorBoard(vendorLayout) {
  const layouts = vendorLayout.layouts;
  return {
    width: layouts.width,
    height: layouts.height,
    keys: layouts.keys.map(key => ({
      x: key.x,
      y: key.y,
      w: key.w,
      h: key.h,
      usage: key.code,
      name: key.name,
    })),
  };
}

/**
 * Match layout keys to device slots by HID usage. Keys that are not plain
 * usages (Fn, media) are matched by their exact entry. Slots that no layout
 * key covers are reported separately so nothing stays unreachable.
 */
export function buildBoard(layout, factoryKeys) {
  const byUsage = new Map();
  const byEntry = new Map();
  factoryKeys.forEach((key, slot) => {
    const usage = effectiveUsage(key);
    if (usage != null) {
      if (!byUsage.has(usage)) byUsage.set(usage, slot);
      return;
    }
    const fingerprint = `${key.type}:${key.code1}:${key.code2}`;
    if (!byEntry.has(fingerprint)) byEntry.set(fingerprint, slot);
  });

  const keys = layout.keys.map(layoutKey => {
    let slot = null;
    if (layoutKey.entry) {
      const fingerprint = `${layoutKey.entry.type}:${layoutKey.entry.code1}:${layoutKey.entry.code2}`;
      slot = byEntry.has(fingerprint) ? byEntry.get(fingerprint) : null;
    } else if (layoutKey.usage != null) {
      slot = byUsage.has(layoutKey.usage) ? byUsage.get(layoutKey.usage) : null;
    }
    return { ...layoutKey, slot };
  });

  const used = new Set(keys.map(k => k.slot).filter(s => s !== null));
  const unmapped = factoryKeys
    .map((key, slot) => ({ ...key, slot }))
    .filter(key => !used.has(key.slot) && !isEmptyEntry(key));

  return {
    keys,
    unmapped,
    width: layout.width || 20,
    height: layout.height || 6.5,
  };
}

/**
 * Paint a board into a container.
 * options: { layerKeys, selectedSlot, diffAgainst, colorFor, onSelect, compact }
 */
export function renderBoard(container, board, options = {}) {
  const {
    layerKeys = null,
    selectedSlot = null,
    diffAgainst = null,
    colorFor = null,
    onSelect = null,
    label = 'Keyboard layout',
  } = options;

  container.textContent = '';
  container.setAttribute('role', 'group');
  container.setAttribute('aria-label', label);
  const fullWidth = board.width * UNIT;
  const fullHeight = board.height * UNIT;
  const available = (container.parentElement?.clientWidth || fullWidth) - 36;
  const scale = Math.min(1, Math.max(0.5, available / fullWidth));
  container.style.width = `${fullWidth * scale}px`;
  container.style.height = `${fullHeight * scale}px`;
  container.style.transform = scale < 1 ? `scale(${scale})` : 'none';
  container.style.transformOrigin = 'top left';

  for (const key of board.keys) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'key';
    const w = key.w || 1;
    el.style.left = `${key.x * UNIT}px`;
    el.style.top = `${key.y * UNIT}px`;
    el.style.width = `${w * UNIT - 4}px`;
    el.style.height = `${UNIT - 4}px`;

    const entry = key.slot !== null && layerKeys ? layerKeys[key.slot] : null;
    const assignment = entry ? decodeKey(entry.type, entry.code1, entry.code2) : key.name;

    const cap = document.createElement('span');
    cap.className = 'cap';
    cap.textContent = assignment || key.name;
    el.appendChild(cap);

    const parts = [key.name];
    if (entry && assignment && assignment !== key.name) parts.push(assignment);

    if (key.slot === null) {
      el.classList.add('is-unmapped');
      el.title = `${key.name}: no matching slot in the keyboard keymap`;
      el.disabled = true;
      el.setAttribute('aria-label', `${key.name}, no matching slot in the keyboard keymap`);
    } else {
      el.dataset.slot = String(key.slot);
      el.title = `${key.name} - slot ${key.slot}${entry ? ` - ${label}` : ''}`;
      if (selectedSlot === key.slot) el.classList.add('is-selected');
      if (diffAgainst && entry) {
        const original = diffAgainst[key.slot];
        if (original && (original.type !== entry.type || original.code1 !== entry.code1 || original.code2 !== entry.code2)) {
          el.classList.add('is-remapped');
          const mark = document.createElement('span');
          mark.className = 'mark';
          mark.setAttribute('aria-hidden', 'true');
          el.appendChild(mark);
          parts.push('changed from factory');
        }
      }
      el.setAttribute('aria-label', parts.join(', '));
      if (colorFor) {
        const color = colorFor(key.slot);
        if (color) {
          el.style.background = `linear-gradient(180deg, ${color}, ${shade(color, -18)})`;
          el.style.borderColor = shade(color, -40);
          el.classList.add('color-key');
        }
      }
      if (onSelect) el.addEventListener('click', () => onSelect(key.slot));
    }
    container.appendChild(el);
  }
}

function shade(hex, amount) {
  const value = hex.replace('#', '');
  const num = parseInt(value.length === 3
    ? value.split('').map(c => c + c).join('')
    : value, 16);
  const r = Math.max(0, Math.min(255, (num >> 16) + amount));
  const g = Math.max(0, Math.min(255, ((num >> 8) & 0xff) + amount));
  const b = Math.max(0, Math.min(255, (num & 0xff) + amount));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}
