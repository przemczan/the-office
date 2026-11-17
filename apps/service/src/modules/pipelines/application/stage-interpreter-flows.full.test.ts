import { describe, expect, it } from "vitest";
import { straightLineFlow } from "../domain/flow.js";
import type { Stage } from "../domain/stage.js";
import {
  aDoneResult,
  anAgentSession,
  anAgentStage,
  runsOf,
  startPipelinesApplication,
  walkStages,
} from "../pipelines-application.fixtures.js";

const implement = anAgentStage("implement");
const review = anAgentStage("review", { optional: true });
const ship: Stage = {
  kind: "script",
  key: "ship",
  name: "Ship",
  optional: false,
  command: "build",
};

const LIST: readonly Stage[] = [implement, review, ship];

/** What each run of the Task's walk did, in order, and how many Agent Stage sessions ran. */
async function walked(stages: readonly Stage[], met: readonly number[]) {
  const pipelines = await startPipelinesApplication([
    anAgentSession(aDoneResult("Done.", "Nothing is left.", met)),
    anAgentSession(aDoneResult()),
  ]);
  try {
    const taskId = await walkStages(pipelines, stages);
    const runs = (await runsOf(pipelines, taskId)).map(({ stageKey, outcome }) => [
      stageKey,
      outcome?.status,
      outcome !== undefined && "summary" in outcome && outcome.summary.startsWith("Skipped"),
    ]);
    return { runs, sessions: pipelines.stageThreads.requests.length };
  } finally {
    await pipelines.app.close();
  }
}

describe("A converted Pipeline's Stages", () => {
  it("walk as the list did, skipping the optional Stage once the Definition of Done is met", async () => {
    const asTheList = await walked(LIST, [1, 2]);
    const asAFlow = await walked(straightLineFlow(LIST), [1, 2]);

    expect(asAFlow).toEqual(asTheList);
    expect(asAFlow.runs).toEqual([
      ["implement", "done", false],
      ["review", "done", true],
      ["ship", "done", false],
    ]);
  });

  it("walk as the list did, running the optional Stage while something isn't met", async () => {
    const asTheList = await walked(LIST, [2]);
    const asAFlow = await walked(straightLineFlow(LIST), [2]);

    expect(asAFlow).toEqual(asTheList);
    expect(asAFlow.sessions).toBe(2);
  });
});
