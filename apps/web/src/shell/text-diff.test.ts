import { describe, expect, it } from "vitest";
import { textDiff } from "./text-diff.ts";

describe("the diff of a long text", () => {
  it("keeps the lines both share and marks the others removed or added", () => {
    expect(textDiff("one\ntwo\nthree", "one\n2\nthree")).toBe("@@ @@\n one\n-two\n+2\n three\n");
  });

  it("is all added from no text, and all removed to none", () => {
    expect(textDiff("", "a\nb")).toBe("@@ @@\n+a\n+b\n");
    expect(textDiff("a", "")).toBe("@@ @@\n-a\n");
  });
});
