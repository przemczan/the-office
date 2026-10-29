import { describe, expect, it } from "vitest";
import { inQuietHours, quietHoursEnd } from "./notification-timing.js";

/** On the service's local clock, as quiet hours are. */
const at = (day: number, hours: number, minutes = 0): Date =>
  new Date(2026, 9, day, hours, minutes);

describe("quiet hours", () => {
  const overnight = { from: "22:00", to: "07:00" };
  const afternoon = { from: "13:00", to: "14:30" };

  it("are off until set", () => {
    expect(inQuietHours(undefined, at(29, 23))).toBe(false);
  });

  it("run across midnight when they end earlier in the day than they start", () => {
    expect(inQuietHours(overnight, at(29, 21, 59))).toBe(false);
    expect(inQuietHours(overnight, at(29, 22))).toBe(true);
    expect(inQuietHours(overnight, at(30, 0, 30))).toBe(true);
    expect(inQuietHours(overnight, at(30, 6, 59))).toBe(true);
    expect(inQuietHours(overnight, at(30, 7))).toBe(false);
  });

  it("run within a day otherwise", () => {
    expect(inQuietHours(afternoon, at(29, 12, 59))).toBe(false);
    expect(inQuietHours(afternoon, at(29, 14, 29))).toBe(true);
    expect(inQuietHours(afternoon, at(29, 14, 30))).toBe(false);
  });

  it("end at the next time the clock reads their end", () => {
    expect(quietHoursEnd(overnight, at(29, 23))).toEqual(at(30, 7));
    expect(quietHoursEnd(overnight, at(30, 1))).toEqual(at(30, 7));
    expect(quietHoursEnd(afternoon, at(29, 13, 10))).toEqual(at(29, 14, 30));
  });
});
