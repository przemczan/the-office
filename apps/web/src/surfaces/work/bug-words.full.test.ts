import { describe, expect, it } from "vitest";
import { foundInVersionTags } from "./bug-words.ts";

describe("foundInVersionTags", () => {
  it("offers the v* tags alone, newest version first", () => {
    expect(foundInVersionTags(["v1.9.0", "nightly", "v1.14.2", "v1.14.0", "v1.14.10"])).toEqual([
      "v1.14.10",
      "v1.14.2",
      "v1.14.0",
      "v1.9.0",
    ]);
  });
});
