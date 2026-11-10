import { describe, expect, it } from "vitest";
import { diffLines } from "./unified-diff.ts";

describe("diffLines", () => {
  it("tells the file header, hunks, added, removed and unchanged lines apart", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "index 1111111..2222222 100644",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,2 +1,2 @@",
      " keep",
      "-old",
      "+new",
      "--- a removed line that starts with dashes",
      "+++ an added line that starts with pluses",
      "diff --git a/b.md b/b.md",
      "--- a/b.md",
      "",
    ].join("\n");

    expect(diffLines(diff).map(({ kind }) => kind)).toEqual([
      "file",
      "file",
      "file",
      "file",
      "hunk",
      "context",
      "removed",
      "added",
      "removed",
      "added",
      "file",
      "file",
    ]);
  });

  it("has no lines for no diff", () => {
    expect(diffLines("")).toEqual([]);
  });
});
