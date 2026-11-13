import { describe, expect, it } from "vitest";
import type { Now } from "./now.js";
import { officeStatusText } from "./office-status.js";
import { NO_TOKENS } from "./office-day.js";

const AN_HOUR_AGO = new Date("2026-10-27T09:00:00Z");

function nowWith(parts: Pick<Now, "needsYou" | "running">): Now {
  return {
    ...parts,
    queue: [],
    tokensToday: NO_TOKENS,
    tasksTouched: 0,
    desks: { inUse: parts.running.length, limit: 3 },
    usageWindows: [],
    fireAlarm: undefined,
  };
}

describe("officeStatusText", () => {
  it("names what waits on the user and every started Task with its Stage and person", () => {
    const text = officeStatusText(
      nowWith({
        needsYou: [
          {
            kind: "decision",
            decisionId: "d1",
            taskId: "t1",
            projectId: "p1",
            waitingSince: AN_HOUR_AGO,
          },
          {
            kind: "gate",
            taskId: "t2",
            projectId: "p1",
            stageKey: "review",
            waitingSince: AN_HOUR_AGO,
          },
          {
            kind: "gate",
            taskId: "t3",
            projectId: "p1",
            stageKey: "review",
            waitingSince: AN_HOUR_AGO,
          },
        ],
        running: [
          {
            taskId: "t1",
            title: "Rename dialog",
            projectId: "p1",
            state: "in-progress",
            pausedBy: undefined,
            resumesAt: undefined,
            stage: { key: "build", name: "Implement", role: "developer", since: AN_HOUR_AGO },
          },
          {
            taskId: "t4",
            title: "Nightly export",
            projectId: "p1",
            state: "paused",
            pausedBy: undefined,
            resumesAt: undefined,
            stage: undefined,
          },
        ],
      }),
    );

    expect(text).toBe(
      [
        "Waiting on the user: 1 Decision, 2 Gates.",
        "Started Tasks (whoever is on none is available):",
        "- Rename dialog (Task t1) · In progress · Stage Implement, worked by the Role developer",
        "- Nightly export (Task t4) · Paused, before its first Stage",
      ].join("\n"),
    );
  });

  it("says when nothing waits and nothing is started", () => {
    expect(officeStatusText(nowWith({ needsYou: [], running: [] }))).toBe(
      "Nothing waits on the user.\nNo Task is started: everyone is available.",
    );
  });
});
