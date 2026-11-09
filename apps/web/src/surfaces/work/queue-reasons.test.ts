import { describe, expect, it } from "vitest";
import { reasonsBesideBlockers } from "./queue-reasons.ts";

describe("reasonsBesideBlockers", () => {
  it("drops the blockers' reasons and keeps the rest in their order", () => {
    const officeLimit = "The Office-wide limit is reached: all 3 desks are in use.";
    const taskLimit = "The Project's Task limit is reached: 2 Tasks are in progress.";
    const cap = "The 5-hour window is at its cap.";
    const behind = 'Queued behind "Rework the importer" until it is Done or Dropped.';

    expect(
      reasonsBesideBlockers([
        officeLimit,
        'Blocked by "Name the import formats", which must be Done first.',
        taskLimit,
        cap,
        'Blocked by "Agree the export columns", which must be Done first.',
        behind,
      ]),
    ).toEqual([officeLimit, taskLimit, cap, behind]);
  });

  it("leaves none when only blockers hold the Task", () => {
    expect(
      reasonsBesideBlockers(['Blocked by "Write the export schema", which must be Done first.']),
    ).toEqual([]);
  });
});
