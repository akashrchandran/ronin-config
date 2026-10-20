/**
 * Tests for the keyboard games: the shared board helpers, snake, lights out,
 * memory and the reaction trainer. Run it with `node games.test.mjs`.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildField, neighbour, neighbours } from './web/games/board.js';
import { SnakeGame } from './web/games/snake.js';
import { LightsOut } from './web/games/lights-out.js';
import { MemoryGame } from './web/games/memory.js';
import { ReactionGame, REACTION_TARGETS } from './web/games/reaction.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const vendor = JSON.parse(fs.readFileSync(path.join(here, 'layout', '320f_5055_2.json'), 'utf8'));
const keys = vendor.layouts.keys.map(key => ({
  x: key.x, y: key.y, w: key.w, h: key.h, name: key.name, usage: key.code,
}));
const field = buildField(keys);

// ---- the shared board -----------------------------------------------------

assert.equal(field.rows.length, 6, 'the board has six rows');
assert.equal(field.rows[1][0].name, '~', 'the second row is the number row');
assert.equal(neighbour(field, field.rows[1][0], 'right').name, '1');
assert.equal(neighbour(field, field.rows[1][0], 'left'), null, 'the edge has no neighbour');
assert.equal(neighbour(field, field.rows[0].find(k => k.name === 'F1'), 'down').name, '1');
assert.equal(neighbours(field, field.rows[1][0]).length, 3, 'the first key has three neighbours');

// ---- snake ----------------------------------------------------------------

const snake = new SnakeGame(field, { random: () => 0 });
snake.start();
assert.equal(snake.phase, 'running');
assert.equal(snake.head.name, '7', 'the snake starts in the middle of the number row');
snake.step();
assert.equal(snake.head.name, '8');
assert.equal(snake.snake.length, 1);
snake.steer('left');                     // a direct reverse is refused
snake.step();
assert.equal(snake.head.name, '9');

// eating
const score = snake.score;
snake.food = neighbour(field, snake.head, snake.direction);
snake.step();
assert.equal(snake.score, score + 1, 'eating the food scores a point');
assert.equal(snake.snake.length, 2, 'the snake grows when it eats');

snake.steer('up');
snake.step();
assert.ok(field.rows[0].includes(snake.head), 'the snake turned up into the function row');

// the wall
const edge = new SnakeGame(field, { random: () => 0 });
edge.start();
edge.snake = [field.rows[1][field.rows[1].length - 1]];
edge.direction = 'right';
assert.equal(edge.step().phase, 'over', 'no key to the right means the game is over');

// ---- lights out -----------------------------------------------------------

const lights = new LightsOut(field, { random: () => 0.9 });
lights.start();
const litCount = lights.lit.size;
assert.ok(litCount > 0, 'the puzzle starts with some lights on');
const target = field.rows[1][3];
const affected = [target, ...neighbours(field, target)];
const states = new Map(affected.map(key => [key, lights.lit.has(key)]));
lights.press(target);
assert.equal(lights.moves, 1);
for (const [key, wasLit] of states) {
  assert.equal(lights.lit.has(key), !wasLit, 'the key and its neighbours toggle');
}
// a fresh puzzle is built from presses, so pressing them again solves it
const solvable = new LightsOut(field, { random: () => 0.5 });
solvable.start();
for (const key of solvable.answer) solvable.press(key);
assert.equal(solvable.lit.size, 0, 'the puzzle can be solved');
assert.equal(solvable.phase, 'solved');
assert.equal(solvable.info().label, 'moves');

// ---- memory ---------------------------------------------------------------

const memory = new MemoryGame(field, { random: () => 0 });
memory.start();
assert.equal(memory.phase, 'show');
assert.equal(memory.sequence.length, 1, 'the first round is one key');
memory.tick();
assert.ok(memory.flash, 'the first key lights up');
const shown = memory.flash;
memory.tick();
assert.equal(memory.flash, null, 'the key goes dark again');
memory.tick();
memory.tick();
assert.equal(memory.phase, 'input', 'the player gets the turn');
memory.press(shown);
assert.equal(memory.index, 1, 'the right key counts');
assert.equal(memory.sequence.length, 2, 'the sequence grows');

// a wrong key ends the game
for (let i = 0; i < 20 && memory.phase !== 'input'; i++) memory.tick();
assert.equal(memory.phase, 'input', 'the player gets the turn again');
const wrong = field.keys.find(key => key !== memory.sequence[0]);
memory.press(wrong);
assert.equal(memory.phase, 'over');

// ---- reaction -------------------------------------------------------------

let clock = 0;
const reaction = new ReactionGame(field, {
  random: () => 0,
  now: () => clock,
});
reaction.start();
reaction.tick();
assert.equal(reaction.phase, 'wait', 'the target waits a while');
clock = 1000;
reaction.tick();
assert.equal(reaction.phase, 'ready', 'the target appears');
const targetKey = reaction.target;
clock = 1250;
reaction.press(targetKey);
assert.equal(reaction.times.length, 1, 'a hit is recorded');
assert.equal(reaction.times[0], 250, 'the reaction time is measured from the light');

// pressing early is a miss
clock = 2000;
reaction.press(targetKey);
assert.equal(reaction.misses, 1, 'pressing before the target appears is a miss');
assert.equal(reaction.info().label, 'best');

// a round is ten targets, and then the game is over
const round = new ReactionGame(field, { random: () => 0, now: () => clock });
round.start();
for (let i = 0; i < REACTION_TARGETS; i++) {
  clock += 2000;
  round.tick();
  round.press(round.target);
}
assert.equal(round.phase, 'over', 'the round ends after ten targets');
assert.equal(round.times.length, REACTION_TARGETS, 'every target was hit');
assert.ok(round.info().text.startsWith('Round over'), 'the result is reported');

console.log('ok: board helpers, snake, lights out, memory and reaction');
