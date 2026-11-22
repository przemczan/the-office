import { describe, expect, it } from "vitest";
import { branchWords } from "./pull-request-words.ts";

describe("pull request words", () => {
  it("names a pull request's branch into its base", () => {
    expect(branchWords({ branch: "office/abc", baseBranch: "main" })).toBe("office/abc → main");
  });
});
