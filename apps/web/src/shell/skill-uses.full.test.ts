import { describe, expect, it } from "vitest";
import { skillUsesLabel } from "./skill-uses.ts";

describe("skillUsesLabel", () => {
  it("says a skill nobody used isn't used", () => {
    expect(skillUsesLabel(0)).toBe("Not used in the last 7 days");
  });

  it("says once for a single use", () => {
    expect(skillUsesLabel(1)).toBe("Used once in the last 7 days");
  });

  it("gives the number of uses beyond one", () => {
    expect(skillUsesLabel(2)).toBe("Used 2 times in the last 7 days");
    expect(skillUsesLabel(37)).toBe("Used 37 times in the last 7 days");
  });
});
