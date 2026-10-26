// The bored-at-a-stop clock. Pure (no three.js, no DOM) so it can be unit-tested with an injected clock.

/** How long the Gardener waits at a stop before getting bored. The user-visible default. */
export const BOREDOM_SECONDS = 180;

const EPS = 1e-6; // float slack so 180 s of 0.05 s steps lands exactly on the threshold

/**
 * Counts how long the Gardener has been settled at one stop.
 *
 *   update(dt, { key, settled, paused }) every simulation step
 *     key      identifies the current stop (`career:apple`, `project:milopop`); null = no stop is active
 *     settled  he has arrived and stopped there (not walking, not being steered)
 *     paused   hold the clock: tab hidden, Local Lab handoff… (the elapsed time is kept, not reset)
 *
 * The clock re-arms (elapsed 0, not bored) whenever the key changes or he is not settled, so walking,
 * switching stops and revisiting a stop all start a fresh interval. Once bored it stays bored until
 * that happens: no second cycle, no repeated trigger. Incidental input (mouse moves) never reaches
 * it, so it can't reset the clock.
 */
export class BoredomClock {
  constructor(seconds = BOREDOM_SECONDS) {
    this.seconds = seconds;
    this.key = null;
    this.elapsed = 0;
    this.bored = false;
  }

  reset() { this.elapsed = 0; this.bored = false; }

  update(dt, { key = null, settled = false, paused = false } = {}) {
    if (key !== this.key) { this.key = key; this.reset(); }
    if (key === null || !settled) { this.reset(); return this.bored; }
    if (!paused && !this.bored) {
      this.elapsed += dt;
      if (this.elapsed + EPS >= this.seconds) this.bored = true;
    }
    return this.bored;
  }
}
