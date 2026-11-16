import { afterEach, describe, expect, it, vi } from "vitest";
import { glanceAt, sippingAt } from "./glances.ts";
import type { HeadGlance } from "./live-view-types.ts";

const FROM = Date.parse("2026-11-16T09:00:00Z");
const STEP_MS = 50;
const SPAN_MS = 20 * 60_000;

interface Moment {
  readonly start: number;
  readonly end: number;
  readonly value: string;
}

/** The moments over twenty minutes, sampled every 50 ms. */
function momentsOf(valueAt: (epochMs: number) => string | null): Moment[] {
  const moments: Moment[] = [];
  let open: { start: number; value: string } | null = null;
  for (let at = FROM; at <= FROM + SPAN_MS; at += STEP_MS) {
    const value = valueAt(at);
    if (value !== null && open === null) open = { start: at, value };
    else if (value === null && open !== null) {
      moments.push({ ...open, end: at });
      open = null;
    }
  }
  return moments;
}

const glances = (roleKey: string): Moment[] =>
  momentsOf((at) => {
    const glance: HeadGlance = glanceAt(roleKey, at);
    return glance === "ahead" ? null : glance;
  });
const sips = (roleKey: string): Moment[] =>
  momentsOf((at) => (sippingAt(roleKey, at) ? "sip" : null));

function gapsOf(moments: readonly Moment[]): number[] {
  return moments.slice(1).map((moment, i) => moment.start - moments[i]!.start);
}

describe("Glances and sips", () => {
  afterEach(() => vi.restoreAllMocks());

  it("are the same for the same Role key and time, never Math.random()", () => {
    const random = vi.spyOn(Math, "random");
    expect(glances("developer")).toEqual(glances("developer"));
    expect(sips("developer")).toEqual(sips("developer"));
    expect(random).not.toHaveBeenCalled();
    expect(glances("developer")).not.toEqual(glances("office-manager"));
  });

  it("turns the head every 6 to 20 seconds, for 1 to 2 seconds, to either side", () => {
    for (const roleKey of ["developer", "office-manager", "reviewer"]) {
      const moments = glances(roleKey);
      expect(moments.length).toBeGreaterThan(SPAN_MS / 20_000 - 2);
      for (const moment of moments) {
        expect(moment.end - moment.start).toBeGreaterThanOrEqual(1_000 - STEP_MS);
        expect(moment.end - moment.start).toBeLessThanOrEqual(2_000 + STEP_MS);
      }
      for (const gap of gapsOf(moments)) {
        expect(gap).toBeGreaterThanOrEqual(6_000 - STEP_MS);
        expect(gap).toBeLessThanOrEqual(20_000 + STEP_MS);
      }
      const sides = new Set(moments.map((moment) => moment.value));
      expect(sides).toEqual(new Set(["left", "right"]));
    }
  });

  it("raises the cup every 8 to 15 seconds, for about 1.5 seconds", () => {
    for (const roleKey of ["developer", "office-manager", "reviewer"]) {
      const moments = sips(roleKey);
      expect(moments.length).toBeGreaterThan(SPAN_MS / 15_000 - 2);
      for (const moment of moments) {
        expect(Math.abs(moment.end - moment.start - 1_500)).toBeLessThanOrEqual(STEP_MS);
      }
      for (const gap of gapsOf(moments)) {
        expect(gap).toBeGreaterThanOrEqual(8_000 - STEP_MS);
        expect(gap).toBeLessThanOrEqual(15_000 + STEP_MS);
      }
    }
  });
});
