import { describe, expect, it } from "vitest";
import { distinctShortReasons, reasonsBesideBlockers, type QueueReason } from "./queue-reasons.ts";

function blocked(title: string): QueueReason {
  return { reason: `Blocked by "${title}", which must be Done first.`, short: "Blocked" };
}

describe("reasonsBesideBlockers", () => {
  it("drops the blockers' reasons and keeps the rest in their order, each with its short reason", () => {
    const officeLimit = {
      reason: "The Office-wide limit is reached: all 3 desks are in use.",
      short: "Office-wide limit reached (3)",
    };
    const projectLimit = {
      reason: "The Project limit is reached: 2 of Admin panel's Tasks are started.",
      short: "Project limit reached (2)",
    };
    const behind = {
      reason: 'Queued behind "Rework the importer" until it is Done or Dropped.',
      short: 'Behind "Rework the importer"',
    };
    const waits = [
      officeLimit,
      blocked("Name the import formats"),
      projectLimit,
      blocked("Agree the export columns"),
      behind,
    ];

    expect(
      reasonsBesideBlockers({
        reasons: waits.map(({ reason }) => reason),
        shortReasons: waits.map(({ short }) => short),
      }),
    ).toEqual([officeLimit, projectLimit, behind]);
  });

  it("leaves none when only blockers hold the Task", () => {
    expect(
      reasonsBesideBlockers({
        reasons: ['Blocked by "Write the export schema", which must be Done first.'],
        shortReasons: ["Blocked"],
      }),
    ).toEqual([]);
  });

  it("stands the full reason in for a Task queued before short reasons", () => {
    const reason = "The Office-wide limit is reached: the only desk is in use.";

    expect(reasonsBesideBlockers({ reasons: [reason], shortReasons: [] })).toEqual([
      { reason, short: reason },
    ]);
  });
});

describe("distinctShortReasons", () => {
  it("names a short reason once, as the same cap on two engines reads the same", () => {
    const cap = "5-hour window cap (80%) · resets 14:30";

    expect(
      distinctShortReasons([
        { reason: "The Claude Code engine's 5-hour window …", short: cap },
        { reason: "The Work account engine's 5-hour window …", short: cap },
        { reason: "The fire alarm is on.", short: "Fire alarm on" },
      ]),
    ).toEqual([cap, "Fire alarm on"]);
  });
});
