import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../test/test-application.js";
import { DayFiguresModule } from "../day-figures.module.js";
import { TaskOutcomeRepository } from "../ports/task-outcome-repository.js";
import { DayFigures } from "./day-figures.js";

let app: INestApplication;
let figures: DayFigures;
let outcomes: TaskOutcomeRepository;

beforeAll(async () => {
  ({ app } = await startTestApplication({ database: true, imports: [DayFiguresModule] }));
  figures = app.get(DayFigures);
  outcomes = app.get(TaskOutcomeRepository);
});

afterAll(async () => {
  await app.close();
});

describe("DayFigures.failedTasks", () => {
  it("gives each Task that failed in the office day once, at its latest failure, with its Stage", async () => {
    // Outcomes are one table for every test file, so this test takes a day of its own.
    const year = 3000 + Math.floor(Math.random() * 6000);
    const on = (date: number, hour: number, minute = 0) => new Date(year, 2, date, hour, minute);
    const [twice, unnamed, before, after, done] = [1, 2, 3, 4, 5].map(() => randomUUID()) as [
      string,
      string,
      string,
      string,
      string,
    ];
    for (const outcome of [
      { taskId: twice, outcome: "failed", occurredAt: on(2, 9), stageName: "Implement" },
      { taskId: twice, outcome: "failed", occurredAt: on(2, 15), stageName: "Tests" },
      { taskId: unnamed, outcome: "failed", occurredAt: on(2, 0) },
      { taskId: before, outcome: "failed", occurredAt: on(1, 23, 59), stageName: "Tests" },
      { taskId: after, outcome: "failed", occurredAt: on(3, 0), stageName: "Tests" },
      { taskId: done, outcome: "done", occurredAt: on(2, 12) },
    ] as const) {
      await outcomes.add(outcome);
    }

    const failed = await figures.failedTasks(`${year}-03-02`);

    expect(failed).toEqual([
      { taskId: twice, stageName: "Tests", at: on(2, 15) },
      { taskId: unnamed, stageName: undefined, at: on(2, 0) },
    ]);
  });

  it("gives none for text that isn't a day", async () => {
    expect(await figures.failedTasks("2026-02-30")).toEqual([]);
  });
});
