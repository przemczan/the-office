import { describe, expect, it } from "vitest";
import { apiEndpointIdFor } from "./engines.js";

// The same cases as the Engine module's own `apiEndpointIdFor`, which this mirrors.
describe("an added API endpoint's id", () => {
  it("keeps the name's letters and digits", () => {
    expect(apiEndpointIdFor(" Strata · Büro 2 ", new Set())).toBe("strata-buro-2");
  });

  it("is told apart from the ids taken", () => {
    expect(apiEndpointIdFor("Strata", new Set(["strata", "strata-2"]))).toBe("strata-3");
  });

  it("is empty for a name without letters or digits", () => {
    expect(apiEndpointIdFor("!!!", new Set())).toBe("");
  });
});
