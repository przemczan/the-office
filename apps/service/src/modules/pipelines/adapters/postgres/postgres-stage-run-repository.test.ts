import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { aStageRun } from "../../domain/stage-run.fixtures.js";
import type { StageRun } from "../../domain/stage-run.js";
import { PostgresStageRunRepository } from "./postgres-stage-run-repository.js";

let app: INestApplication;
let runs: PostgresStageRunRepository;

beforeAll(async () => {
  ({ app } = await startTestApplication({
    database: true,
    providers: [PostgresStageRunRepository],
  }));
  runs = app.get(PostgresStageRunRepository);
});

afterAll(async () => {
  await app.close();
});

function thisWeek(hour: number): Date {
  return new Date(Date.UTC(2099, 2, 2, hour));
}

describe("PostgresStageRunRepository.startedSince", () => {
  it("gives each run started since with its tokens, a retry this week of a Stage first run last week counted as a retry", async () => {
    // Tests share the database, so only this test's own Tasks are looked at, far in the future.
    const since = new Date("2099-03-02T00:00:00.000Z");
    const lastWeek = new Date("2099-02-27T10:00:00.000Z");
    const [oneTask, otherTask] = [randomUUID(), randomUUID()];
    const tokens = { input: 10, output: 20, cacheRead: 1_000, cacheCreation: 5 };
    const saved = async (taskId: string, number: number, fields: Partial<StageRun>) =>
      runs.saveNew(aStageRun({ id: randomUUID(), taskId, number, ...fields }));
    await saved(oneTask, 1, { stageKey: "implement", startedAt: lastWeek });
    await saved(oneTask, 2, { stageKey: "implement", startedAt: thisWeek(8), tokens });
    await saved(oneTask, 3, { stageKey: "review", startedAt: thisWeek(9) });
    await saved(otherTask, 1, { stageKey: "implement", startedAt: since });
    const ours = new Set<string>([oneTask, otherTask]);

    const started = (await runs.startedSince(since)).filter(({ taskId }) => ours.has(taskId));

    expect(started).toHaveLength(3);
    expect(started).toEqual(
      expect.arrayContaining([
        { taskId: oneTask, tokens, retry: true },
        {
          taskId: oneTask,
          tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
          retry: false,
        },
        {
          taskId: otherTask,
          tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
          retry: false,
        },
      ]),
    );
  });
});
