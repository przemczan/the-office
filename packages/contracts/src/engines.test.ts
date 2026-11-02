import { describe, expect, it } from "vitest";
import { engineIdFor } from "./engines.js";

// The same cases as the Engine module's own `engineIdFor`, which this mirrors.
describe("an added engine's id", () => {
  it("keeps the name's letters and digits", () => {
    expect(engineIdFor(" Strata · Büro 2 ", new Set())).toBe("strata-buro-2");
  });

  it("is told apart from the ids taken", () => {
    expect(engineIdFor("Strata", new Set(["strata", "strata-2"]))).toBe("strata-3");
  });

  it("is empty for a name without letters or digits", () => {
    expect(engineIdFor("!!!", new Set())).toBe("");
  });
});
