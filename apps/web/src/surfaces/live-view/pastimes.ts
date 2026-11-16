import type { Exercise, Light, OfficePerson, Pastime, SpotPastime } from "./live-view-types.ts";
import { pickFrom, seedOf, seededRandom } from "./seeded.ts";

/** Idle this long, counted from dawn at the latest, a nap at the desk can be picked. */
export const ASLEEP_AFTER_MINUTES = 30;
/** Each turn of an idle person's time lasts this long, in whole minutes, seeded by their Role key. */
export const TURN_SHORTEST_MINUTES = 4;
export const TURN_LONGEST_MINUTES = 8;

const MINUTE = 60_000;

/** A pastime that can be picked for a turn: any but sitting at the desk, which is only a fallback. */
export type PickedPastime = Exclude<Pastime, "desk">;

/**
 * How often each pastime is picked, relative to the others. Each pastime is one entry, so dropping
 * one is a one-line change.
 */
const PASTIME_WEIGHTS: readonly { readonly pastime: PickedPastime; readonly weight: number }[] = [
  { pastime: "coffee", weight: 3 },
  { pastime: "water", weight: 2 },
  { pastime: "sofa", weight: 3 },
  { pastime: "beanbag", weight: 2 },
  { pastime: "exercise", weight: 2 },
  { pastime: "bookshelf", weight: 2 },
  { pastime: "plant", weight: 1 },
  { pastime: "nap", weight: 3 },
];

export const PICKED_PASTIMES: readonly PickedPastime[] = PASTIME_WEIGHTS.map(
  ({ pastime }) => pastime,
);

const SPOT_PASTIMES: readonly SpotPastime[] = PICKED_PASTIMES.filter(
  (pastime): pastime is SpotPastime => pastime !== "nap",
);

const EXERCISES: readonly [Exercise, ...Exercise[]] = ["jumping-jacks", "squats", "push-ups"];

/** One turn of an idle person's time, and what they picked for it. */
export interface PastimeTurn {
  /** From 0, the first turn after they fell idle or after dawn. */
  readonly index: number;
  /** When it starts, in minutes after the turns began counting. */
  readonly start: number;
  /** How long it lasts, in whole minutes. */
  readonly length: number;
  readonly pastime: PickedPastime;
  /** Which exercise, should they end up on the mat. */
  readonly exercise: Exercise;
  /**
   * The spots' pastimes to try, in order, when the pick's spots are all taken: the pick first, then
   * the person's own seeded order of the rest, never last turn's pick. Empty for a nap.
   */
  readonly preferences: readonly SpotPastime[];
}

/**
 * When an idle person's turns begin counting: when they fell idle, or today's dawn when that is
 * later, so those who walk back in at dawn never start with a nap (design decision 12).
 */
export function turnsCountFrom(
  person: Pick<OfficePerson, "idleSince">,
  light: Light,
): number | null {
  const idleSince = person.idleSince === null ? -Infinity : Date.parse(person.idleSince);
  const from = Math.max(idleSince, light.dawnAt ?? -Infinity);
  return Number.isFinite(from) ? from : null;
}

/** Each turn's own random numbers, from the Role key's seed and the turn's index. */
function turnRandom(keySeed: number, index: number): () => number {
  return seededRandom(keySeed ^ Math.imul(index + 1, 0x9e3779b1));
}

function weightedPick(random: () => number, allowed: readonly PickedPastime[]): PickedPastime {
  const weights = PASTIME_WEIGHTS.filter(({ pastime }) => allowed.includes(pastime));
  const total = weights.reduce((sum, { weight }) => sum + weight, 0);
  let left = random() * total;
  for (const { pastime, weight } of weights) {
    left -= weight;
    if (left < 0) return pastime;
  }
  return weights[weights.length - 1]?.pastime ?? "coffee";
}

/** The rest of the spots' pastimes in a seeded order (Fisher–Yates). */
function shuffled(random: () => number, pastimes: readonly SpotPastime[]): SpotPastime[] {
  const order = [...pastimes];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  return order;
}

function turnOf(
  keySeed: number,
  index: number,
  start: number,
  previous: PickedPastime | null,
): PastimeTurn {
  const random = turnRandom(keySeed, index);
  const length =
    TURN_SHORTEST_MINUTES +
    Math.floor(random() * (TURN_LONGEST_MINUTES - TURN_SHORTEST_MINUTES + 1));
  const allowed = PICKED_PASTIMES.filter(
    (pastime) => pastime !== previous && (pastime !== "nap" || start >= ASLEEP_AFTER_MINUTES),
  );
  const pastime = weightedPick(random, allowed);
  const exercise = pickFrom(random, EXERCISES);
  const preferences =
    pastime === "nap"
      ? []
      : [
          pastime,
          ...shuffled(
            random,
            SPOT_PASTIMES.filter((other) => other !== pastime && other !== previous),
          ),
        ];
  return { index, start, length, pastime, exercise, preferences };
}

/**
 * The turn someone idle for `minutes` is in. Turns run back to back from 0, each 4 to 8 minutes
 * long, and each picks from the weighted list with the Role key and its index as the seed: the same
 * person at the same minute always picks the same, on every reload and in every browser. Never the
 * same pastime twice in a row, and a nap only in a turn starting 30 minutes or more in.
 */
export function pastimeTurnAt(roleKey: string, minutes: number): PastimeTurn {
  const keySeed = seedOf(roleKey);
  const elapsed = withinTwoWeeks(Math.max(0, minutes));
  let turn = turnOf(keySeed, 0, 0, null);
  while (elapsed >= turn.start + turn.length) {
    turn = turnOf(keySeed, turn.index + 1, turn.start + turn.length, turn.pastime);
  }
  return turn;
}

const WEEK_MINUTES = 7 * 24 * 60;

/**
 * Turns are worked out one after the other, so a long idle time (only where there is no dawn to
 * count from: a polar day or a time zone without a place) is folded into its second week.
 */
function withinTwoWeeks(minutes: number): number {
  return minutes < 2 * WEEK_MINUTES ? minutes : WEEK_MINUTES + (minutes % WEEK_MINUTES);
}

/** The turn an idle person is in now, counting from `turnsCountFrom`; without a time, the first. */
export function pastimeTurnOf(
  person: Pick<OfficePerson, "roleKey" | "idleSince">,
  now: Date,
  light: Light,
): PastimeTurn {
  const from = turnsCountFrom(person, light);
  return pastimeTurnAt(person.roleKey, from === null ? 0 : (now.getTime() - from) / MINUTE);
}
