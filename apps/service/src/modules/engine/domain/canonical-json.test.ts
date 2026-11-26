import { describe, expect, it } from "vitest";
import { canonicalJson, fingerprintOf } from "./canonical-json.js";

describe("the fingerprint of an Office action's fields", () => {
  it("is the same whatever the order of the keys, nested ones included", () => {
    const first = { state: "ready", values: { title: "A", priority: 2 } };
    const second = { values: { priority: 2, title: "A" }, state: "ready" };

    expect(canonicalJson(first)).toBe(canonicalJson(second));
    expect(fingerprintOf(first)).toBe(fingerprintOf(second));
  });

  it("differs once a field's value differs, and ignores a field left undefined", () => {
    expect(fingerprintOf({ state: "ready" })).not.toBe(fingerprintOf({ state: "running" }));
    expect(fingerprintOf({ state: "ready", note: undefined })).toBe(
      fingerprintOf({ state: "ready" }),
    );
  });
});
