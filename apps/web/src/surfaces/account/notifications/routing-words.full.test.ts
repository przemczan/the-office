import { describe, expect, it } from "vitest";
import { cellTitle, columnNote, isSetHere, ROUTING_GROUPS } from "./routing-words.ts";

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

describe("ROUTING_GROUPS", () => {
  it("lists a test instance's and an Action run's kinds as one Outcomes row each, after Initiative done", () => {
    const outcomes = ROUTING_GROUPS.find(({ level }) => level === "outcomes");
    expect(outcomes?.kinds.map(({ level }) => level).slice(-3)).toEqual([
      "outcomes.initiative-done",
      "outcomes.test-instance",
      "outcomes.action-run",
    ]);
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
