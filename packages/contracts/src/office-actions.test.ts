import { z } from "zod";
import { describe, expect, it } from "vitest";
import {
  AUTHORITY_AREA_GROUPS,
  authorityAreaKeySchema,
  authorityGroupSchema,
  type AuthorityAreaKey,
  type AuthorityGroup,
} from "./authority.js";
import { OFFICE_ACTIONS } from "./office-action-list.js";
import { officeAction } from "./office-actions.js";

function anAction(area: AuthorityAreaKey, group: AuthorityGroup) {
  return officeAction({
    name: "change_something",
    title: "Change something",
    description: "Changes something.",
    input: z.object({ taskId: z.uuid() }),
    answer: z.object({}),
    route: { method: "POST", path: "/tasks/:taskId/something" },
    area,
    group,
    subject: ({ taskId }) => ({ kind: "task", id: taskId }),
  });
}

describe("an Office action's area and group", () => {
  it("are declared from the authority catalog", () => {
    const action = anAction("work", "taskRecords");

    expect(action.area).toBe("work");
    expect(action.group).toBe("taskRecords");
    expect(action.subject({ taskId: "t1" })).toEqual({ kind: "task", id: "t1" });
  });

  it("refuses an area the catalog doesn't have", () => {
    expect(() => anAction("nowhere" as AuthorityAreaKey, "taskRecords")).toThrow(
      "The Office action change_something's area nowhere isn't in the catalog.",
    );
  });

  it("refuses a group the catalog doesn't have", () => {
    expect(() => anAction("work", "nothing" as AuthorityGroup)).toThrow(
      "The Office action change_something's group nothing isn't in the catalog.",
    );
  });

  it("refuses a group that sits in another area", () => {
    expect(() => anAction("work", "ideas")).toThrow(
      "The Office action change_something's group ideas isn't in the area work.",
    );
  });

  it("holds for every declared Office action", () => {
    for (const { name, area, group } of OFFICE_ACTIONS) {
      expect({ name, inCatalog: authorityAreaKeySchema.safeParse(area).success }).toEqual({
        name,
        inCatalog: true,
      });
      expect({ name, inCatalog: authorityGroupSchema.safeParse(group).success }).toEqual({
        name,
        inCatalog: true,
      });
      expect({ name, groups: AUTHORITY_AREA_GROUPS[area] }).toEqual({
        name,
        groups: expect.arrayContaining([group]),
      });
    }
  });

  it("has Restart from, Start over and Reopen as Office actions of Work's Gates and runs", () => {
    const runControls = OFFICE_ACTIONS.filter(({ name }) =>
      ["restart_task_from", "start_task_over", "reopen_task"].includes(name),
    );

    expect(
      runControls.map(({ name, route }) => `${name} ${route.method} ${route.path}`).toSorted(),
    ).toEqual([
      "reopen_task POST /tasks/:taskId/reopen",
      "restart_task_from POST /tasks/:taskId/restart",
      "start_task_over POST /tasks/:taskId/start-over",
    ]);
    for (const { area, group } of runControls) {
      expect({ area, group }).toEqual({ area: "work", group: "gatesAndRuns" });
    }
  });
});
