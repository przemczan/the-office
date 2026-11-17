import { describe, expect, it } from "vitest";
import {
  TOP_TASKS,
  weekStatsOf,
  type StatsStageRun,
  type StatsTask,
  type StatsTokens,
} from "./basic-stats.js";

function inputTokens(input: number, cacheRead = 0): StatsTokens {
  return { input, output: 0, cacheRead, cacheCreation: 0 };
}

function aTask(id: string, projectId = "office"): StatsTask {
  return { id, title: `Task ${id}`, projectId };
}

function aRun(taskId: string, tokens: StatsTokens, retry = false): StatsStageRun {
  return { taskId, tokens, retry };
}

describe("weekStatsOf", () => {
  it("sums each Task's counted tokens, cache reads left out, and lists the top 10 most first", () => {
    const tasks = Array.from({ length: 12 }, (_, index) => aTask(`t${index}`));
    const runs = tasks.map(({ id }, index) => aRun(id, inputTokens(index * 10)));
    const stats = weekStatsOf({
      runs: [
        ...runs,
        aRun("t0", { input: 5, output: 7, cacheRead: 1_000_000, cacheCreation: 3 }),
        aRun("t0", inputTokens(500)),
      ],
      doneTaskIds: [],
      tasks,
      filter: "all",
    });

    expect(stats.topTasks).toHaveLength(TOP_TASKS);
    expect(stats.topTasks[0]).toEqual({
      taskId: "t0",
      title: "Task t0",
      projectId: "office",
      tokens: 515,
    });
    expect(stats.topTasks.slice(1).map(({ taskId }) => taskId)).toEqual([
      "t11",
      "t10",
      "t9",
      "t8",
      "t7",
      "t6",
      "t5",
      "t4",
      "t3",
    ]);
  });

  it("narrows the top Tasks, Tasks done and Stage retries by the Task's Project", () => {
    const tasks = [aTask("ours", "office"), aTask("theirs", "elsewhere")];
    const stats = weekStatsOf({
      runs: [
        aRun("ours", inputTokens(10)),
        aRun("ours", inputTokens(10), true),
        aRun("theirs", inputTokens(99), true),
      ],
      doneTaskIds: ["ours", "theirs"],
      tasks,
      filter: ["office"],
    });

    expect(stats).toEqual({
      topTasks: [{ taskId: "ours", title: "Task ours", projectId: "office", tokens: 20 }],
      tasksDone: 1,
      stageRetries: 1,
    });
  });

  it("counts each done Task once and every retry, leaving out what belongs to an unknown Task", () => {
    const stats = weekStatsOf({
      runs: [
        aRun("known", inputTokens(1), true),
        aRun("known", inputTokens(1), true),
        aRun("gone", inputTokens(1_000), true),
      ],
      doneTaskIds: ["known", "known", "gone"],
      tasks: [aTask("known")],
      filter: "all",
    });

    expect(stats).toEqual({
      topTasks: [{ taskId: "known", title: "Task known", projectId: "office", tokens: 2 }],
      tasksDone: 1,
      stageRetries: 2,
    });
  });
});
