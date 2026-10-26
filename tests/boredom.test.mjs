import test from 'node:test';
import assert from 'node:assert/strict';
import { BoredomClock, BOREDOM_SECONDS } from '../src/avatar/boredom.js';

const STOP = { key: 'career:apple', settled: true };
// feed `seconds` of simulated time in `step`-sized slices; returns the clock's bored flag after each
function run(clock, seconds, step, input = STOP) {
  const n = Math.round(seconds / step);
  for (let i = 0; i < n; i++) clock.update(step, input);
}

test('the shipped default is exactly 180 seconds', () => {
  assert.equal(BOREDOM_SECONDS, 180);
  assert.equal(new BoredomClock().seconds, 180);
});

test('no boredom at 179.9 s, boredom at 180.0 s', () => {
  const c = new BoredomClock();
  run(c, 179.9, 0.1);
  assert.equal(c.bored, false);
  c.update(0.1, STOP);
  assert.equal(c.bored, true);
});

test('same result at a 60 fps and a 20 fps step', () => {
  for (const step of [1 / 60, 0.05]) {
    const c = new BoredomClock();
    run(c, 179.9, step);
    assert.equal(c.bored, false, `step ${step} at 179.9`);
    run(c, 0.2, step);
    assert.equal(c.bored, true, `step ${step} at 180.1`);
  }
});

test('walking (not settled) resets and re-arms a fresh interval', () => {
  const c = new BoredomClock();
  run(c, 170, 0.1);
  c.update(0.1, { ...STOP, settled: false });
  assert.equal(c.elapsed, 0);
  run(c, 179.9, 0.1);
  assert.equal(c.bored, false);
  run(c, 0.1, 0.1);
  assert.equal(c.bored, true);
});

test('switching stops, and revisiting a stop, starts a new 180 s interval', () => {
  const c = new BoredomClock();
  run(c, 175, 0.1);
  c.update(0.1, { key: 'career:vice', settled: true });
  assert.ok(c.elapsed < 1 && !c.bored);
  run(c, 175, 0.1, { key: 'career:vice', settled: true });
  c.update(0.1, STOP); // back to the first stop
  assert.ok(c.elapsed < 1 && !c.bored);
});

test('once bored it stays bored and does not retrigger a cycle', () => {
  const c = new BoredomClock();
  run(c, 200, 0.1);
  assert.equal(c.bored, true);
  const e = c.elapsed;
  run(c, 600, 0.1);
  assert.equal(c.bored, true);
  assert.equal(c.elapsed, e);
});

test('moving or leaving the stop clears boredom immediately', () => {
  const c = new BoredomClock();
  run(c, 181, 0.1);
  assert.equal(c.bored, true);
  c.update(0.016, { ...STOP, settled: false });
  assert.equal(c.bored, false);
  c.update(0.016, { key: null, settled: true });
  assert.equal(c.bored, false);
});

test('a paused clock keeps its elapsed time and resumes, never fires while paused', () => {
  const c = new BoredomClock();
  run(c, 100, 0.1);
  run(c, 500, 0.1, { ...STOP, paused: true }); // tab hidden / Local Lab for 500 s
  assert.equal(c.bored, false);
  assert.ok(Math.abs(c.elapsed - 100) < 1e-6);
  run(c, 79.9, 0.1);
  assert.equal(c.bored, false);
  run(c, 0.1, 0.1);
  assert.equal(c.bored, true);
});

test('pausing before the interval ends does not trigger on return', () => {
  const c = new BoredomClock();
  run(c, 179.5, 0.1);
  run(c, 30, 0.1, { ...STOP, paused: true });
  assert.equal(c.bored, false);
});

test('without an active stop the clock never runs', () => {
  const c = new BoredomClock();
  run(c, 1000, 0.1, { key: null, settled: true });
  assert.equal(c.bored, false);
});
