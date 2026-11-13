import { describe, expect, it } from "vitest";
import { returnPathOf } from "./users.ts";

describe("where the sign-in page returns to", () => {
  it("returns to a path of this app with its query", () => {
    expect(returnPathOf("/work?view=board")).toBe("/work?view=board");
    expect(returnPathOf("/tasks/7c1d")).toBe("/tasks/7c1d");
  });

  it("returns home for nothing, another site or the sign-in page itself", () => {
    expect(returnPathOf(undefined)).toBe("/");
    expect(returnPathOf("")).toBe("/");
    expect(returnPathOf("https://evil.example/")).toBe("/");
    expect(returnPathOf("//evil.example/")).toBe("/");
    expect(returnPathOf("/\\evil.example/")).toBe("/");
    expect(returnPathOf("javascript:alert(1)")).toBe("/");
    expect(returnPathOf("/sign-in")).toBe("/");
    expect(returnPathOf("/sign-in?returnTo=%2Fwork")).toBe("/");
  });
});
