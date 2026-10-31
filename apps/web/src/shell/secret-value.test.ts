import { describe, expect, it } from "vitest";
import { secretOnSave } from "./secret-value.ts";

describe("a secret value on Save", () => {
  it("keeps the value kept, takes a new one, or removes it", () => {
    expect(secretOnSave(undefined, true)).toBe("kept-set");
    expect(secretOnSave(undefined, false)).toBe("kept-none");
    expect(secretOnSave("ghp_new", true)).toBe("new");
    expect(secretOnSave("", true)).toBe("removed");
    expect(secretOnSave("", false)).toBe("kept-none");
  });
});
