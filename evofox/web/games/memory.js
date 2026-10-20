/**
 * Memory, the Simon game, on the keyboard.
 *
 * The board flashes a sequence of keys and the player repeats it. The app's
 * clock drives the flash: one tick lit, one tick dark.
 */
export class MemoryGame {
  constructor(field, { random = Math.random } = {}) {
    this.field = field;
    this.random = random;
    this.reset();
  }

  reset() {
    this.sequence = [];
    this.index = 0;
    this.phase = 'show';
    this.step = 0;
    this.flash = null;
    this.flashOn = false;
    this.best = 0;
  }

  start() {
    this.reset();
    this.nextKey();
  }

  stop() {
    this.phase = 'ready';
    this.flash = null;
  }

  nextKey() {
    const pool = this.field.keys;
    this.sequence.push(pool[Math.floor(this.random() * pool.length)]);
    this.step = 0;
    this.flash = null;
    this.flashOn = false;
  }

  tick() {
    if (this.phase !== 'show') return;
    if (!this.flashOn) {
      if (this.step >= this.sequence.length) {
        this.phase = 'input';
        this.index = 0;
        return;
      }
      this.flash = this.sequence[this.step];
      this.flashOn = true;
    } else {
      this.flash = null;
      this.flashOn = false;
      this.step += 1;
    }
  }

  press(key) {
    if (this.phase !== 'input') return;
    if (key !== this.sequence[this.index]) {
      this.phase = 'over';
      this.flash = null;
      return;
    }
    this.index += 1;
    if (this.index >= this.sequence.length) {
      this.best = Math.max(this.best, this.sequence.length);
      this.phase = 'show';
      this.nextKey();
    }
  }

  paint() {
    const map = new Map();
    for (let i = 0; i < this.index; i++) map.set(this.sequence[i], '#5b3a3c');
    if (this.flash) map.set(this.flash, '#ffffff');
    return map;
  }

  info() {
    const text = this.phase === 'over'
      ? `Wrong key. You got ${this.index} of ${this.sequence.length}.`
      : this.phase === 'input'
        ? 'Your turn.'
        : 'Watch.';
    return { text, score: this.best, label: 'best' };
  }
}
