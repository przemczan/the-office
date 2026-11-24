import { describe, expect, it } from "vitest";
import { recordTabOf } from "./record-tab.ts";

describe("recordTabOf", () => {
  it("names the Changes, Attachments and Engine tabs", () => {
    expect(recordTabOf("changes")).toBe("changes");
    expect(recordTabOf("attachments")).toBe("attachments");
    expect(recordTabOf("engine")).toBe("engine");
  });

  it("leaves Overview and anything unknown out", () => {
    expect(recordTabOf("overview")).toBeUndefined();
    expect(recordTabOf(undefined)).toBeUndefined();
  });
});
