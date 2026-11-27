import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { officeDayBounds, officeDayOf } from "./office-day.js";

const hours = ({ start, end }: { start: Date; end: Date }) =>
  (end.getTime() - start.getTime()) / 3_600_000;

describe("the office day", () => {
  it("is the local calendar day, from its midnight to the next day's", () => {
    expect(officeDayOf(new Date(2026, 10, 27, 0, 0, 0))).toBe("2026-11-27");
    expect(officeDayOf(new Date(2026, 10, 27, 23, 59, 59, 999))).toBe("2026-11-27");
    expect(officeDayOf(new Date(2026, 10, 28, 0, 0, 0))).toBe("2026-11-28");
  });

  it("has bounds that include its midnight and leave out the next one", () => {
    const bounds = officeDayBounds("2026-12-31")!;
    expect(bounds.start).toEqual(new Date(2026, 11, 31));
    expect(bounds.end).toEqual(new Date(2027, 0, 1));
    expect(officeDayOf(bounds.start)).toBe("2026-12-31");
    expect(officeDayOf(new Date(bounds.end.getTime() - 1))).toBe("2026-12-31");
    expect(officeDayOf(bounds.end)).toBe("2027-01-01");
  });

  describe("across a DST change", () => {
    let zone: string | undefined;

    beforeAll(() => {
      zone = process.env.TZ;
      process.env.TZ = "Europe/Warsaw";
    });
    afterAll(() => {
      if (zone === undefined) delete process.env.TZ;
      else process.env.TZ = zone;
    });

    it("is 23 hours long when the clock goes forward, and still ends at the next midnight", () => {
      const bounds = officeDayBounds("2026-03-29")!;
      expect(hours(bounds)).toBe(23);
      expect(officeDayOf(bounds.end)).toBe("2026-03-30");
      expect(officeDayOf(new Date(bounds.end.getTime() - 1))).toBe("2026-03-29");
    });

    it("is 25 hours long when the clock goes back, and still ends at the next midnight", () => {
      const bounds = officeDayBounds("2026-10-25")!;
      expect(hours(bounds)).toBe(25);
      expect(officeDayOf(bounds.end)).toBe("2026-10-26");
      expect(officeDayOf(new Date(bounds.end.getTime() - 1))).toBe("2026-10-25");
    });
  });

  it("has no bounds for text that isn't a real day", () => {
    expect(officeDayBounds("today")).toBeUndefined();
    expect(officeDayBounds("2026-1-5")).toBeUndefined();
    expect(officeDayBounds("2026-02-30")).toBeUndefined();
  });
});
