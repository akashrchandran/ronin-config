/**
 * Picture to per-key colours.
 *
 * The board's physical grid is the canvas: every key samples the colour at
 * its own position, so a picture lands on the keys where they physically
 * are rather than in a grid that ignores the layout. The browser app feeds
 * this from a canvas, the MCP server from a text grid; both end up writing
 * the same per-key colour table.
 */
import { RGB_MAX } from './protocol.js';

/**
 * Sample a colour for every key of the board.
 *
 * @param {Array<{x:number,y:number,w:number,h:number}>} keys board keys
 * @param {number} width board width in key units
 * @param {number} height board height in key units
 * @param {(x:number, y:number) => ({r:number,g:number,b:number}|null)} sample
 *   colour at a position, both in the range 0..1
 * @returns {Array<{key:object, r:number, g:number, b:number}>}
 */
export function sampleKeys(keys, width, height, sample) {
  const out = [];
  for (const key of keys) {
    const x = (key.x + key.w / 2) / width;
    const y = (key.y + key.h / 2) / height;
    const colour = sample(x, y);
    if (!colour) continue;
    out.push({
      key,
      r: Math.min(RGB_MAX, Math.max(0, colour.r | 0)),
      g: Math.min(RGB_MAX, Math.max(0, colour.g | 0)),
      b: Math.min(RGB_MAX, Math.max(0, colour.b | 0)),
    });
  }
  return out;
}

/**
 * A text grid as a colour source. Rows are strings of hex colours separated
 * by spaces, for example "ff0000 00ff00 0000ff". The grid covers the whole
 * board; cells outside the text are black.
 *
 * @param {string[]} rows
 * @returns {(x:number, y:number) => ({r:number,g:number,b:number}|null)}
 */
export function gridSource(rows) {
  const cells = rows.map(row => row.trim().split(/\s+/).filter(Boolean).map(cell => {
    const match = /^#?([0-9a-f]{6})$/i.exec(cell);
    if (!match) return null;
    const value = parseInt(match[1], 16);
    return { r: (value >> 16) & 0xff, g: (value >> 8) & 0xff, b: value & 0xff };
  }));
  const height = cells.length;
  const width = cells.reduce((widest, row) => Math.max(widest, row.length), 0);
  return (x, y) => {
    const column = Math.min(width - 1, Math.floor(x * width));
    const row = Math.min(height - 1, Math.floor(y * height));
    return cells[row]?.[column] ?? { r: 0, g: 0, b: 0 };
  };
}
