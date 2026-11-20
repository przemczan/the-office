import { describe, expect, it } from "vitest";
import { effectiveStageContextLimits } from "./stage-context-limits.js";

const OFFICE_DEFAULTS = { soft: 100_000, hard: 180_000 };

describe("effectiveStageContextLimits", () => {
  it("takes the Stage's own limits when it sets them", () => {
    expect(
      effectiveStageContextLimits(
        { kind: "set", limits: { soft: 60_000, hard: 90_000 } },
        OFFICE_DEFAULTS,
      ),
    ).toEqual({ soft: 60_000, hard: 90_000 });
  });

  it("gives none for No limit", () => {
    expect(effectiveStageContextLimits({ kind: "none" }, OFFICE_DEFAULTS)).toBeUndefined();
  });

  it("takes the Office defaults for a Stage without limits of its own", () => {
    expect(effectiveStageContextLimits(undefined, OFFICE_DEFAULTS)).toEqual(OFFICE_DEFAULTS);
  });
});
