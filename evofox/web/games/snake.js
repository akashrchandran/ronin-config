/**
 * Snake for the keyboard's per-key lights.
 *
 * The logic here is free of the DOM so it can be tested on its own.
 */
import { DIRECTIONS, OPPOSITE, neighbour } from './board.js';

export class SnakeGame {
  /**
   * @param {{rows: Array, keys: Array}} field the keys the snake may use
   * @param {{random?: Function}} [options]
   */
  constructor(field, { random = Math.random } = {}) {
    this.field = field;
    this.random = random;
    this.reset();
  }

  reset() {
    const row = this.field.rows[Math.min(1, this.field.rows.length - 1)];
    const head = row[Math.floor(row.length / 2)];
    this.snake = [head];
    this.direction = 'right';
    this.turn = null;
    this.score = 0;
    this.phase = 'ready';
    this.food = this.placeFood();
  }

  start() {
    if (this.phase === 'over') this.reset();
    this.phase = 'running';
  }

  stop() {
    this.phase = 'ready';
  }

  /** Queue a turn. A direct reverse is ignored, as in the arcade game. */
  steer(direction) {
    if (!DIRECTIONS[direction]) return;
    if (this.direction && direction === OPPOSITE[this.direction]) return;
    this.turn = direction;
  }

  /** Advance the game one step. */
  step() {
    if (this.phase !== 'running') return { phase: this.phase, score: this.score };
    if (this.turn) {
      this.direction = this.turn;
      this.turn = null;
    }
    const head = this.snake[0];
    const next = neighbour(this.field, head, this.direction);
    if (!next) {
      this.phase = 'over';
      return { phase: 'over', score: this.score };
    }
    if (this.snake.some(part => part === next)) {
      this.phase = 'over';
      return { phase: 'over', score: this.score };
    }
    const ate = next === this.food;
    this.snake.unshift(next);
    if (ate) {
      this.score += 1;
      this.food = this.placeFood();
    } else {
      this.snake.pop();
    }
    return { phase: 'running', score: this.score, ate };
  }

  /** The app's clock: one step per tick. */
  tick() {
    return this.step();
  }

  /** A key the snake is not on. */
  placeFood() {
    const taken = new Set(this.snake);
    const free = this.field.keys.filter(key => !taken.has(key));
    if (!free.length) return null;
    return free[Math.floor(this.random() * free.length)];
  }

  /** The keys that are lit, and in what colour. */
  paint() {
    const map = new Map();
    for (const part of this.snake) map.set(part, '#e5484d');
    if (this.head) map.set(this.head, '#ffffff');
    if (this.food) map.set(this.food, '#46b17b');
    return map;
  }

  info() {
    return {
      text: this.phase === 'over' ? `Game over. Score ${this.score}.` : 'Playing.',
      score: this.score,
      label: 'score',
    };
  }

  get head() {
    return this.snake[0];
  }

  get body() {
    return this.snake.slice(1);
  }
}
