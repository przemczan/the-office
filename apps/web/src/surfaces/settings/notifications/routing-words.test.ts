import { describe, expect, it } from "vitest";
import { cellTitle, columnNote, isSetHere } from "./routing-words.ts";

describe("cellTitle", () => {
  it("says whether the row sets the channel, takes it from its group, or nothing does", () => {
    expect(cellTitle("outcomes.task-failed", { on: true, from: "outcomes.task-failed" })).toBe(
      "Set here",
    );
    expect(cellTitle("outcomes.task-done", { on: true, from: "outcomes" })).toBe(
      "Inherited from Outcomes",
    );
    expect(cellTitle("office.alarm-lifted", { on: false, from: null })).toBe("Off");
  });
});

describe("isSetHere", () => {
  it("is the row's own setting only", () => {
    expect(isSetHere("office", { on: true, from: "office" })).toBe(true);
    expect(isSetHere("office.down", { on: true, from: "office" })).toBe(false);
  });
});

describe("columnNote", () => {
  it("tells what each channel is, the desktop as this browser allows it", () => {
    expect(columnNote("in-app", "granted")).toBe("Toast, tab title and status strip");
    expect(columnNote("desktop", "granted")).toBe("Allowed in this browser");
    expect(columnNote("desktop", "denied")).toBe("Blocked in this browser");
    expect(columnNote("phone", "granted")).toBe("Not set up yet");
  });
});
