import { describe, expect, it } from "vitest";
import { ciRunStatusOf } from "./ci-run-status.js";

describe("ciRunStatusOf", () => {
  it("maps a run that isn't completed by its status", () => {
    expect(ciRunStatusOf("queued", null)).toBe("queued");
    expect(ciRunStatusOf("waiting", null)).toBe("waiting");
    expect(ciRunStatusOf("in_progress", null)).toBe("running");
  });

  it("maps a completed run by its conclusion", () => {
    expect(ciRunStatusOf("completed", "success")).toBe("succeeded");
    expect(ciRunStatusOf("completed", "failure")).toBe("failed");
    expect(ciRunStatusOf("completed", "cancelled")).toBe("cancelled");
    expect(ciRunStatusOf("completed", "skipped")).toBe("skipped");
  });

  it("is unknown for a status or conclusion it doesn't know", () => {
    expect(ciRunStatusOf("completed", null)).toBe("unknown");
    expect(ciRunStatusOf("somewhere_new", null)).toBe("unknown");
  });
});
