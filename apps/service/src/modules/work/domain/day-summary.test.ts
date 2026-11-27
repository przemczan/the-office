import { describe, expect, it } from "vitest";
import { groupDay, type DayFacts } from "./day-summary.js";

const at = (hour: number) => new Date(2026, 10, 26, hour);

const NO_FACTS: DayFacts = {
  initiativesDone: [],
  tasksDone: [],
  pullRequestsMerged: [],
  failedOrDropped: [],
  ideasCaptured: [],
  tasksStarted: [],
};

function done(id: string, projectId: string, hour: number): DayFacts["tasksDone"][number] {
  return { id, title: id, projectId, kind: "feature", pullRequestNumber: undefined, at: at(hour) };
}

describe("groupDay", () => {
  it("puts each group's newest first", () => {
    const groups = groupDay(
      { ...NO_FACTS, tasksDone: [done("a", "p", 9), done("c", "p", 15), done("b", "p", 11)] },
      "all",
    );

    expect(groups.tasksDone.map(({ id }) => id)).toEqual(["c", "b", "a"]);
    expect(groups.elsewhere).toBe(0);
  });

  it("narrows every group to the Projects shown and counts what it hides", () => {
    const groups = groupDay(
      {
        ...NO_FACTS,
        tasksDone: [done("mine", "p", 9), done("theirs", "q", 10)],
        tasksStarted: [{ id: "s", title: "s", projectId: "q", at: at(9) }],
        initiativesDone: [
          { id: "i", name: "i", projectIds: ["q", "p"], taskCount: 2, at: at(9) },
          { id: "j", name: "j", projectIds: ["q"], taskCount: 1, at: at(9) },
        ],
        ideasCaptured: [
          { id: "office-wide", title: "x", projectId: undefined, at: at(9) },
          { id: "other", title: "y", projectId: "q", at: at(9) },
        ],
      },
      ["p"],
    );

    expect(groups.tasksDone.map(({ id }) => id)).toEqual(["mine"]);
    expect(groups.initiativesDone.map(({ id }) => id)).toEqual(["i"]);
    expect(groups.ideasCaptured.map(({ id }) => id)).toEqual(["office-wide"]);
    expect(groups.tasksStarted).toEqual([]);
    expect(groups.elsewhere).toBe(4);
  });
});
