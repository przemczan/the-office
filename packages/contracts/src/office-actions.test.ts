import { z } from "zod";
import { describe, expect, it } from "vitest";
import { OFFICE_ACTIONS } from "./office-action-list.js";
import { officeAction, type OfficeActionCover } from "./office-actions.js";

function anAction(coveredBy: OfficeActionCover) {
  return officeAction({
    name: "change_something",
    record: "task",
    description: "Changes something.",
    input: z.object({ taskId: z.uuid() }),
    answer: z.object({}),
    route: { method: "POST", path: "/tasks/:taskId/something" },
    coveredBy,
  });
}

describe("an Office action's cover", () => {
  it("is held duties or whoever creates the record, exactly one kind", () => {
    expect(anAction({ kind: "duties", duties: ["plans"] }).coveredBy).toEqual({
      kind: "duties",
      duties: ["plans"],
    });
    expect(anAction({ kind: "creators", record: "task" }).coveredBy).toEqual({
      kind: "creators",
      record: "task",
    });
  });

  it("refuses a duties cover naming no duty", () => {
    const none = { kind: "duties", duties: [] } as unknown as OfficeActionCover;

    expect(() => anAction(none)).toThrow(
      "The Office action change_something names no duty that covers it.",
    );
  });

  it("covers the actions made before creators by held duties", () => {
    const byDuties = OFFICE_ACTIONS.filter(({ coveredBy }) => coveredBy.kind === "duties").map(
      ({ name }) => name,
    );

    expect(byDuties).toEqual([
      "add_dependency",
      "remove_dependency",
      "add_to_initiative",
      "take_out_of_initiative",
      "rerun_ci_run",
      "start_workflow",
    ]);
  });
});
