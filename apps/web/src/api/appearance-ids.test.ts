import { DENSITY_IDS, PALETTE_IDS } from "@the-office/contracts";
import { DENSITIES, PALETTES } from "@the-office/ui";
import { describe, expect, it } from "vitest";

// packages/ui doesn't depend on the contracts, so the web, which has both, holds them equal.
describe("the appearance's ids", () => {
  it("are the palettes and densities packages/ui draws, neither more nor fewer", () => {
    expect(PALETTE_IDS.toSorted()).toEqual(Object.keys(PALETTES).toSorted());
    expect(DENSITY_IDS.toSorted()).toEqual(Object.keys(DENSITIES).toSorted());
  });
});
