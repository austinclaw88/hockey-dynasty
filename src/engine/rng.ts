// Deterministic seeded RNG (mulberry32). State is a single 32-bit integer that
// is threaded through GameState.rngState so that saves are fully reproducible.
// NEVER use Math.random() anywhere in the engine.

export class Rng {
  private a: number
  constructor(seed: number) {
    this.a = seed | 0
  }
  /** Current internal state — write this back into GameState.rngState. */
  get state(): number {
    return this.a
  }
  /** Next float in [0, 1). */
  next(): number {
    this.a = (this.a + 0x6d2b79f5) | 0
    let t = Math.imul(this.a ^ (this.a >>> 15), 1 | this.a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1))
  }
  /** Float in [min, max). */
  float(min: number, max: number): number {
    return min + this.next() * (max - min)
  }
  /** True with probability p. */
  chance(p: number): boolean {
    return this.next() < p
  }
  /** Pick a random element (returns undefined for empty arrays). */
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)]
  }
  /** In-place Fisher-Yates shuffle. */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1))
      const tmp = arr[i]
      arr[i] = arr[j]
      arr[j] = tmp
    }
    return arr
  }
  /** Knuth Poisson sampler; lambda kept small (<= ~5.5) by callers. */
  poisson(lambda: number): number {
    const L = Math.exp(-lambda)
    let k = 0
    let p = 1
    do {
      k++
      p *= this.next()
    } while (p > L)
    return k - 1
  }
}

/** Stable 0..1 hash of a string — for deterministic per-player variation that
 *  must NOT consume RNG state (e.g. asking prices computed on demand by the UI). */
export function hash01(str: string): number {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) / 4294967296
}

/** Deterministic seed derived from a string. */
export function seedFrom(str: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h | 0
}
