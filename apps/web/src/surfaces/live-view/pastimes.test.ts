import { describe, expect, it } from "vitest";
import { DAY_LIGHT, ROSTER, officePerson } from "./live-view.fixtures.ts";
import type { Light, SpotPastime } from "./live-view-types.ts";
import {
  ASLEEP_AFTER_MINUTES,
  PICKED_PASTIMES,
  type PastimeTurn,
  TURN_LONGEST_MINUTES,
  TURN_SHORTEST_MINUTES,
  pastimeTurnAt,
  pastimeTurnOf,
  turnsCountFrom,
} from "./pastimes.ts";

const NOW = new Date(2026, 10, 15, 13, 5);
const MINUTE = 60_000;
const ROLE_KEYS = ROSTER.map((role) => role.roleKey);
const SPOT_PASTIMES = PICKED_PASTIMES.filter((pastime) => pastime !== "nap");
const EXERCISES = ["jumping-jacks", "squats", "push-ups"];

function minutesAgo(minutes: number): string {
  return new Date(NOW.getTime() - minutes * MINUTE).toISOString();
}

/** Day light whose dawn was `minutes` before now. */
function dawnAgo(minutes: number): Light {
  return { ...DAY_LIGHT, phase: "dawn", dawnAt: NOW.getTime() - minutes * MINUTE };
}

/** Every turn of one person's idle time, back to back, up to `minutes`. */
function turnsUpTo(roleKey: string, minutes: number): PastimeTurn[] {
  const turns: PastimeTurn[] = [];
  for (let at = 0; at < minutes;) {
    const turn = pastimeTurnAt(roleKey, at);
    turns.push(turn);
    at = turn.start + turn.length;
  }
  return turns;
}

const TWELVE_HOURS = 12 * 60;

describe("pastimes", () => {
  it("picks the same turn for the same Role key at the same minute", () => {
    for (const roleKey of ROLE_KEYS) {
      for (const minutes of [0, 3.5, 31, 247.25, 700]) {
        expect(pastimeTurnAt(roleKey, minutes)).toEqual(pastimeTurnAt(roleKey, minutes));
      }
    }
    const person = officePerson("developer", { idleSince: minutesAgo(95) });
    expect(pastimeTurnOf(person, NOW, DAY_LIGHT)).toEqual(pastimeTurnAt("developer", 95));
  });

  it("runs turns of 4 to 8 whole minutes back to back, the same turn all through it", () => {
    for (const roleKey of ROLE_KEYS) {
      let end = 0;
      for (const [index, turn] of turnsUpTo(roleKey, TWELVE_HOURS).entries()) {
        expect(turn.index).toBe(index);
        expect(turn.start).toBe(end);
        expect(Number.isInteger(turn.length)).toBe(true);
        expect(turn.length).toBeGreaterThanOrEqual(TURN_SHORTEST_MINUTES);
        expect(turn.length).toBeLessThanOrEqual(TURN_LONGEST_MINUTES);
        expect(pastimeTurnAt(roleKey, turn.start + turn.length - 0.01)).toEqual(turn);
        expect(EXERCISES).toContain(turn.exercise);
        end = turn.start + turn.length;
      }
    }
    expect(TURN_SHORTEST_MINUTES).toBe(4);
    expect(TURN_LONGEST_MINUTES).toBe(8);
  });

  it("never picks the same pastime twice in a row", () => {
    for (const roleKey of ROLE_KEYS) {
      const turns = turnsUpTo(roleKey, TWELVE_HOURS);
      for (let i = 1; i < turns.length; i++) {
        expect(turns[i]!.pastime).not.toBe(turns[i - 1]!.pastime);
      }
    }
  });

  it("picks a nap only in a turn starting thirty minutes or more in", () => {
    expect(ASLEEP_AFTER_MINUTES).toBe(30);
    for (const roleKey of ROLE_KEYS) {
      const early = turnsUpTo(roleKey, TWELVE_HOURS).filter(
        (turn) => turn.start < ASLEEP_AFTER_MINUTES,
      );
      expect(early.map((turn) => turn.pastime)).not.toContain("nap");
      for (let minutes = 0; minutes < ASLEEP_AFTER_MINUTES; minutes += 0.5) {
        expect(pastimeTurnAt(roleKey, minutes).pastime).not.toBe("nap");
      }
    }
  });

  it("counts the turns from dawn when dawn came after they fell idle", () => {
    for (const roleKey of ROLE_KEYS) {
      const idleAllNight = officePerson(roleKey, { idleSince: minutesAgo(600) });
      for (const sinceDawn of [0, 10, 29]) {
        const turn = pastimeTurnOf(idleAllNight, NOW, dawnAgo(sinceDawn));
        expect(turn).toEqual(pastimeTurnAt(roleKey, sinceDawn));
        expect(turn.pastime).not.toBe("nap");
      }
      expect(pastimeTurnOf(idleAllNight, NOW, dawnAgo(200))).toEqual(pastimeTurnAt(roleKey, 200));
      expect(pastimeTurnOf(idleAllNight, NOW, DAY_LIGHT)).toEqual(pastimeTurnAt(roleKey, 600));
      // Idle since after dawn: counted from when they fell idle.
      const idleSinceNoon = officePerson(roleKey, { idleSince: minutesAgo(45) });
      expect(pastimeTurnOf(idleSinceNoon, NOW, dawnAgo(300))).toEqual(pastimeTurnAt(roleKey, 45));
    }
    // Counted from when they fell idle, some of them would be napping now; counted from dawn, none is.
    const napsAtNight = ROLE_KEYS.flatMap((roleKey) =>
      [600, 610, 620, 630].map((idle) => [roleKey, idle] as const),
    ).filter(
      ([roleKey, idle]) =>
        pastimeTurnOf(officePerson(roleKey, { idleSince: minutesAgo(idle) }), NOW, DAY_LIGHT)
          .pastime === "nap",
    );
    expect(napsAtNight.length).toBeGreaterThan(0);
  });

  it("starts counting when they fell idle or at dawn, whichever is later, else not at all", () => {
    const dawn = dawnAgo(60);
    expect(turnsCountFrom({ idleSince: minutesAgo(90) }, dawn)).toBe(dawn.dawnAt);
    expect(turnsCountFrom({ idleSince: minutesAgo(30) }, dawn)).toBe(NOW.getTime() - 30 * MINUTE);
    expect(turnsCountFrom({ idleSince: null }, dawn)).toBe(dawn.dawnAt);
    expect(turnsCountFrom({ idleSince: null }, DAY_LIGHT)).toBeNull();
    // Without a time to count from, the first turn.
    expect(pastimeTurnOf(officePerson("developer"), NOW, DAY_LIGHT)).toEqual(
      pastimeTurnAt("developer", 0),
    );
  });

  it("picks every pastime over a long day", () => {
    const picked = new Set<string>();
    for (const roleKey of ROLE_KEYS.slice(0, 6)) {
      for (const turn of turnsUpTo(roleKey, TWELVE_HOURS)) picked.add(turn.pastime);
    }
    expect([...picked].toSorted()).toEqual([...PICKED_PASTIMES].toSorted());
  });

  it("picks games for some, never twice in a row, and falls back to the games seats", () => {
    expect(PICKED_PASTIMES).toContain("games");
    const gamers = ROLE_KEYS.filter((roleKey) =>
      turnsUpTo(roleKey, TWELVE_HOURS).some((turn) => turn.pastime === "games"),
    );
    expect(gamers.length).toBeGreaterThan(0);
    for (const roleKey of ROLE_KEYS) {
      const turns = turnsUpTo(roleKey, TWELVE_HOURS);
      const twiceInARow = turns.filter(
        (turn, i) => turn.pastime === "games" && turns[i - 1]?.pastime === "games",
      );
      expect(twiceInARow).toEqual([]);
      // Any spot pick after a turn of something else may fall back to the games seats.
      const withoutGames = turns.filter(
        (turn, i) =>
          turn.pastime !== "nap" &&
          turns[i - 1]?.pastime !== "games" &&
          !turn.preferences.includes("games"),
      );
      expect(withoutGames).toEqual([]);
    }
  });

  it("orders the spots to try with the pick first, never last turn's pick, and none for a nap", () => {
    for (const roleKey of ROLE_KEYS) {
      const turns = turnsUpTo(roleKey, TWELVE_HOURS);
      turns.forEach((turn, i) => {
        const previous = turns[i - 1]?.pastime;
        const nap = turn.pastime === "nap";
        // The pick first, then every other spot pastime once, last turn's pick left out.
        const others = SPOT_PASTIMES.filter((pastime) => pastime !== previous);
        expect({
          first: turn.preferences[0] ?? null,
          all: [...turn.preferences].toSorted(),
        }).toEqual({
          first: nap ? null : turn.pastime,
          all: nap ? [] : ([...others] as SpotPastime[]).toSorted(),
        });
      });
    }
  });

  it("works out a turn after weeks of idle time without a dawn to count from", () => {
    const turn = pastimeTurnAt("developer", 60 * 24 * 365);
    expect(turn.length).toBeGreaterThanOrEqual(TURN_SHORTEST_MINUTES);
    expect(pastimeTurnAt("developer", 60 * 24 * 365)).toEqual(turn);
  });
});
