import { afterEach, describe, expect, it } from "vitest";
import { weekStartOf } from "./basic-stats.js";

const zoneAtStart = process.env.TZ;

afterEach(() => {
  if (zoneAtStart === undefined) delete process.env.TZ;
  else process.env.TZ = zoneAtStart;
});

/** The local calendar day, as the platform's `officeDayOf` reads it. */
function localDay(at: Date): string {
  const month = String(at.getMonth() + 1).padStart(2, "0");
  const day = String(at.getDate()).padStart(2, "0");
  return `${at.getFullYear()}-${month}-${day}`;
}

/** The local calendar days from `first` on, seven of them. */
function weekFrom(first: Date): readonly string[] {
  return Array.from({ length: 7 }, (_, index) =>
    localDay(new Date(first.getFullYear(), first.getMonth(), first.getDate() + index, 12)),
  );
}

function momentsAround(year: number): readonly Date[] {
  const moments: Date[] = [];
  // Every day of the year, just after and just before local midnight, and at noon.
  for (let day = 0; day < 366; day += 1) {
    moments.push(
      new Date(year, 0, 1 + day, 0, 0, 0, 1),
      new Date(year, 0, 1 + day, 12),
      new Date(year, 0, 2 + day, 0, 0, 0, -1),
    );
  }
  return moments;
}

describe("weekStartOf", () => {
  for (const zone of ["Europe/Warsaw", "America/New_York", "Australia/Sydney", "UTC"]) {
    it(`starts each moment's week at the local midnight of its Monday, across a change of clock (${zone})`, () => {
      process.env.TZ = zone;
      for (const moment of momentsAround(2026)) {
        const start = weekStartOf(moment);

        expect(start.getDay()).toBe(1);
        expect([start.getHours(), start.getMinutes(), start.getSeconds()]).toEqual([0, 0, 0]);
        expect(start.getTime()).toBeLessThanOrEqual(moment.getTime());
        expect(weekFrom(start)).toContain(localDay(moment));
      }
    });
  }

  it("puts a Sunday in the week begun six days before, and a Monday's first moment in its own", () => {
    process.env.TZ = "Europe/Warsaw";
    // Sunday 2026-03-29 is the day Warsaw's clocks go forward.
    const sundayNight = new Date(2026, 2, 29, 23, 59, 59, 999);
    const mondayMidnight = new Date(2026, 2, 30);

    expect(localDay(weekStartOf(sundayNight))).toBe("2026-03-23");
    expect(weekStartOf(mondayMidnight)).toEqual(mondayMidnight);
  });
});
