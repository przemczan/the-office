/* A seeded random: the same Role key always gives the same figure, and the same pastime at the same minute. */

/** FNV-1a over the text's code points (each one's first UTF-16 unit). */
export function seedOf(text: string): number {
  let hash = 2166136261;
  for (const c of text) {
    hash ^= c.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

/** mulberry32: numbers in [0, 1), the same ones for the same seed. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pickFrom<T>(random: () => number, list: readonly [T, ...T[]]): T {
  return list[Math.floor(random() * list.length)] ?? list[0];
}
