import { describe, expect, it } from "vitest";
import { taskStateWords } from "./work-words.ts";

describe("taskStateWords", () => {
  it("reads a Paused Task by what holds it", () => {
    expect(taskStateWords("paused")).toBe("Paused");
    expect(taskStateWords("paused", { stopped: true })).toBe("Stopped");
    expect(taskStateWords("paused", { pausedByAlarm: true })).toBe("Paused by the alarm");
  });

  it("gives the alarm's words over a Stop", () => {
    expect(taskStateWords("paused", { pausedByAlarm: true, stopped: true })).toBe(
      "Paused by the alarm",
    );
  });

  it("names any other state as it is, whatever its Stage last did", () => {
    expect(taskStateWords("in-progress", { stopped: true })).toBe("In progress");
    expect(taskStateWords("dropped", { stopped: true })).toBe("Dropped");
    expect(taskStateWords("waiting-on-you", { pausedByAlarm: true })).toBe("Waiting on you");
  });
});
