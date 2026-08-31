/**
 * Seeded randomness for replicated simulation runs.
 *
 * The engine itself is deterministic (docs/simulation-model.md); the only
 * variability in the product lives here, so an exploration is reproducible:
 * the same seed always produces the same jittered worlds and therefore the
 * same ranking. `Math.random` is never called anywhere in the simulation.
 *
 * Everything is expressed in whole minutes because that is the unit the
 * domain uses for durations, arrivals and part ETAs.
 */

/**
 * mulberry32: a 32-bit PRNG with a single word of state. Small, fast, and
 * good enough for bounded operational jitter — it is not cryptographic.
 * Returns a function yielding uniform values in [0, 1).
 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Derives an independent sub-stream seed from a base seed and an index, so
 * replication `k` of an exploration is always the same world regardless of
 * which candidate is being evaluated (common random numbers).
 */
export function mixSeed(seed: number, index: number): number {
  return (Math.imul(seed >>> 0, 0x85ebca6b) ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0;
}

/** Uniform value in [-1, 1). */
function signed(rng: () => number): number {
  return rng() * 2 - 1;
}

/**
 * Multiplicative jitter: `value` ± `pct`, rounded to whole minutes and never
 * below `min`. Used for step durations ("this job usually takes 90 minutes").
 */
export function jitter(rng: () => number, value: number, pct: number, min = 1): number {
  return Math.max(min, Math.round(value * (1 + signed(rng) * pct)));
}

/**
 * Additive jitter: `value` ± `spread` whole minutes, never below `min`. Used
 * for clock-like quantities — a part ETA or a walk-in arrival — where a
 * percentage of a minute-of-day would be meaningless.
 */
export function jitterBy(rng: () => number, value: number, spread: number, min = 0): number {
  return Math.max(min, value + Math.round(signed(rng) * spread));
}
