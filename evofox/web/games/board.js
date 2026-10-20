/**
 * The board as the games see it.
 *
 * The field is the board's own keys rather than an idealised grid: the games
 * move from key to key, so they follow the real layout, gaps and all. Only
 * keys the firmware gives a colour slot can be part of the field, because a
 * key without one stays dark.
 */

export const DIRECTIONS = {
  up: { dx: 0, dy: -1 },
  right: { dx: 1, dy: 0 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
};

export const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };

/** How far up or down a key may reach for its neighbour, in key units. */
export const REACH = 1.3;

/** Group the board's keys into rows by their vertical position. */
export function buildField(keys) {
  const rows = new Map();
  for (const key of keys) {
    const y = Math.round(key.y * 100) / 100;
    if (!rows.has(y)) rows.set(y, []);
    rows.get(y).push(key);
  }
  const ordered = [...rows.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, row]) => row.sort((a, b) => a.x - b.x));
  return { rows: ordered, keys: ordered.flat() };
}

/** The key next to `key` in `direction`, or null when there is none. */
export function neighbour(field, key, direction) {
  const { dx, dy } = DIRECTIONS[direction];
  const rowIndex = field.rows.findIndex(row => row.includes(key));
  if (rowIndex === -1) return null;

  if (dx) {
    const row = field.rows[rowIndex];
    return row[row.indexOf(key) + dx] || null;
  }

  const target = field.rows[rowIndex + dy];
  if (!target) return null;
  const centre = key.x + key.w / 2;
  let best = null;
  let bestDistance = Infinity;
  for (const candidate of target) {
    const distance = Math.abs(candidate.x + candidate.w / 2 - centre);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return bestDistance <= REACH ? best : null;
}

/** The neighbours of a key, in every direction that has one. */
export function neighbours(field, key) {
  const out = [];
  for (const direction of Object.keys(DIRECTIONS)) {
    const target = neighbour(field, key, direction);
    if (target) out.push(target);
  }
  return out;
}
