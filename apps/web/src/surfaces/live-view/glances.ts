import type { HeadGlance } from "./live-view-types.ts";
import { seedOf } from "./seeded.ts";

/*
 * Now-and-then moments of a still figure, by the wall clock: a glance to one side, a sip from a mug
 * or a paper cup. Each falls once in every slot of `periodMs`, at a seeded point of its first
 * `jitterMs`, so two in a row are `periodMs ± jitterMs` apart. Seeded by the Role key and the slot,
 * never by Math.random(), so a reload or a second browser shows the same moment at the same time.
 * Called every frame: allocates nothing.
 */

interface Beat {
  readonly periodMs: number;
  readonly jitterMs: number;
  readonly shortestMs: number;
  readonly longestMs: number;
  /** Keeps two kinds of moment of one person apart. */
  readonly salt: number;
}

/** A glance every 6 to 20 s, held 1 to 2 s. */
const GLANCE: Beat = {
  periodMs: 13_000,
  jitterMs: 7_000,
  shortestMs: 1_000,
  longestMs: 2_000,
  salt: 0x51f15e,
};

/** A sip every 8 to 15 s, the cup at the mouth for 1.5 s. */
const SIP: Beat = {
  periodMs: 11_500,
  jitterMs: 3_500,
  shortestMs: 1_500,
  longestMs: 1_500,
  salt: 0x2c1b3d,
};

/** mulberry32's `n`th number from `seed`, in [0, 1). */
function unit(seed: number, n: number): number {
  let t = (seed + Math.imul(n, 0x6d2b79f5)) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** The moment's own seeded number in [0, 1) while it lasts at `epochMs`, else -1. */
function beatAt(seed: number, epochMs: number, beat: Beat): number {
  const slot = Math.floor(epochMs / beat.periodMs);
  const slotSeed = (seed ^ Math.imul(slot, 0x9e3779b1) ^ beat.salt) >>> 0;
  const start = unit(slotSeed, 1) * beat.jitterMs;
  const length = beat.shortestMs + unit(slotSeed, 2) * (beat.longestMs - beat.shortestMs);
  const into = epochMs - slot * beat.periodMs;
  return into >= start && into < start + length ? unit(slotSeed, 3) : -1;
}

/** Which way a still figure's head is turned at `epochMs`, by the Role key's seed (`seedOf`). */
export function glanceOfSeed(seed: number, epochMs: number): HeadGlance {
  const side = beatAt(seed, epochMs, GLANCE);
  if (side < 0) return "ahead";
  return side < 0.5 ? "left" : "right";
}

/** Whether the cup is at the mouth at `epochMs`, by the Role key's seed (`seedOf`). */
export function sippingOfSeed(seed: number, epochMs: number): boolean {
  return beatAt(seed, epochMs, SIP) >= 0;
}

/** Which way someone standing or sitting still looks at `epochMs` (milliseconds since the epoch). */
export function glanceAt(roleKey: string, epochMs: number): HeadGlance {
  return glanceOfSeed(seedOf(roleKey), epochMs);
}

/** Whether someone at the coffee machine or the water cooler has the cup at the mouth at `epochMs`. */
export function sippingAt(roleKey: string, epochMs: number): boolean {
  return sippingOfSeed(seedOf(roleKey), epochMs);
}
