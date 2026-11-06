// A custom colour is the user's own data, not a style.
/* oxlint-disable office/restricted-syntax */
import { describe, expect, it } from "vitest";
import { markLabelColour } from "./mark-colours.ts";

describe("markLabelColour", () => {
  it.each(["#ffffff", "#fefefe", "#ffee88", "#99ddbb", "#808080"] as const)(
    "gives the light colour %s the dark label",
    (colour) => {
      expect(markLabelColour(colour)).toBe("var(--gray-950)");
    },
  );

  it.each(["#000000", "#010101", "#3366cc", "#7a1f1f", "#404040"] as const)(
    "gives the dark colour %s the white label",
    (colour) => {
      expect(markLabelColour(colour)).toBe("var(--white)");
    },
  );
});
