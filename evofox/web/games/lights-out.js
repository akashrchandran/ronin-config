/**
 * Lights Out on the keyboard.
 *
 * Pressing a key toggles it and its physical neighbours. The board's own
 * shape is the puzzle: the rows are staggered and the keys are not a matrix,
 * so there is no rectangle to memorise.
 */
import { neighbours } from './board.js';

export class LightsOut {
  constructor(field, { random = Math.random } = {}) {
    this.field = field;
    this.random = random;
    this.reset();
  }

  reset() {
    // The puzzle is built by pressing a few keys on an empty board, so it is
    // always solvable: pressing the same keys again clears it.
    this.lit = new Set();
    this.answer = [];
    const presses = 6 + Math.floor(this.random() * 8);
    for (let i = 0; i < presses; i++) {
      const key = this.field.keys[Math.floor(this.random() * this.field.keys.length)];
      this.answer.push(key);
      this.toggle(key);
    }
    this.moves = 0;
    this.phase = 'ready';
  }

  start() {
    this.phase = 'playing';
  }

  stop() {
    this.phase = 'ready';
  }

  toggle(key) {
    for (const target of [key, ...neighbours(this.field, key)]) {
      if (this.lit.has(target)) this.lit.delete(target);
      else this.lit.add(target);
    }
  }

  press(key) {
    if (this.phase !== 'playing') return;
    this.toggle(key);
    this.moves += 1;
    if (!this.lit.size) this.phase = 'solved';
  }

  /** The app's clock. Lights out waits for the player, so there is nothing to do. */
  tick() {}

  paint() {
    const map = new Map();
    for (const key of this.lit) map.set(key, '#e5484d');
    return map;
  }

  info() {
    return {
      text: this.phase === 'solved'
        ? `Solved in ${this.moves} moves.`
        : 'Press a key to toggle it and its neighbours. Get every light out.',
      score: this.moves,
      label: 'moves',
    };
  }
}
