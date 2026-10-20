/**
 * Reaction trainer on the keyboard.
 *
 * A key lights up after a random delay and the player has to hit it. The
 * time from the light to the press is the score, and pressing too early or
 * hitting the wrong key counts as a miss. A round is ten targets.
 */

/** How many targets make a round. The round ending is what the board flashes for. */
export const REACTION_TARGETS = 10;

export class ReactionGame {
  constructor(field, { random = Math.random, now = () => performance.now() } = {}) {
    this.field = field;
    this.random = random;
    this.now = now;
    this.reset();
  }

  reset() {
    this.phase = 'wait';
    this.target = null;
    this.shownAt = 0;
    this.waitUntil = 0;
    this.times = [];
    this.misses = 0;
    this.targets = 0;
  }

  start() {
    this.reset();
    this.schedule();
  }

  stop() {
    this.phase = 'ready';
    this.target = null;
  }

  schedule() {
    this.phase = 'wait';
    this.target = null;
    this.waitUntil = this.now() + 700 + this.random() * 1800;
  }

  tick() {
    if (this.phase === 'wait') {
      if (this.now() >= this.waitUntil) {
        const pool = this.field.keys;
        this.target = pool[Math.floor(this.random() * pool.length)];
        this.shownAt = this.now();
        this.phase = 'ready';
      }
      return;
    }
    if (this.phase === 'ready' && this.now() - this.shownAt > 4000) {
      this.misses += 1;          // too slow to react
      this.targets += 1;
      if (this.targets >= REACTION_TARGETS) {
        this.phase = 'over';
        this.target = null;
        return;
      }
      this.schedule();
    }
  }

  press(key) {
    if (this.phase === 'ready') {
      if (key === this.target) {
        this.times.push(Math.round(this.now() - this.shownAt));
      } else {
        this.misses += 1;
      }
      this.targets += 1;
      if (this.targets >= REACTION_TARGETS) {
        this.phase = 'over';
        this.target = null;
        return;
      }
      this.schedule();
      return;
    }
    if (this.phase === 'wait') {
      this.misses += 1;          // pressed before the target appeared
      this.schedule();
    }
  }

  paint() {
    const map = new Map();
    if (this.target) map.set(this.target, '#46b17b');
    return map;
  }

  info() {
    const best = this.times.length ? Math.min(...this.times) : null;
    const average = this.times.length
      ? Math.round(this.times.reduce((total, time) => total + time, 0) / this.times.length)
      : null;
    const text = best === null
      ? 'Wait for a key to light, then hit it.'
      : this.phase === 'over'
        ? `Round over: best ${best} ms, average ${average} ms over ${this.times.length} hits.`
        : `Best ${best} ms, average ${average} ms over ${this.times.length} hits.`;
    return { text, score: best ?? 0, label: 'best' };
  }
}
