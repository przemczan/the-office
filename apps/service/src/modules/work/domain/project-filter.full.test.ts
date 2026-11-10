import { describe, expect, it } from "vitest";
import { isInProjectFilter } from "./project-filter.js";

describe("isInProjectFilter", () => {
  it("shows every record under All projects", () => {
    expect(isInProjectFilter(["firmware"], "all")).toBe(true);
  });

  it("always shows a record with no Project", () => {
    expect(isInProjectFilter([], ["firmware"])).toBe(true);
  });

  it("shows a record spanning Projects when any of them is chosen", () => {
    expect(isInProjectFilter(["mobile", "firmware"], ["firmware"])).toBe(true);
    expect(isInProjectFilter(["mobile", "web"], ["firmware"])).toBe(false);
  });
});
