import { afterEach, describe, expect, it } from "vitest";
import { builtInPipelines, SET_UP_TEST_TARGETS_PIPELINE } from "../domain/built-in-pipelines.js";
import {
  aDoneResult,
  anAgentSession,
  runsOf,
  startPipelinesApplication,
  walkStages,
  type PipelinesApplication,
} from "../pipelines-application.fixtures.js";
import { aPerson } from "../ports/pipelines-ports.fixtures.js";

const stages = builtInPipelines.find(({ id }) => id === SET_UP_TEST_TARGETS_PIPELINE)!.stages;

let pipelines: PipelinesApplication;

afterEach(async () => {
  await pipelines.app.close();
});

describe("The Set up test targets Pipeline", () => {
  it("runs its one Stage as whoever onboards Projects, then is Done with nothing run or published", async () => {
    pipelines = await startPipelinesApplication([
      anAgentSession(aDoneResult("Proposed the web and app targets.")),
    ]);
    pipelines.people.people.set("devops", aPerson("Devon"));
    pipelines.people.holders.set("onboards-projects", "devops");

    const taskId = await walkStages(pipelines, stages);

    const runs = await runsOf(pipelines, taskId);
    expect(
      runs.map(({ stageKey, roleKey, outcome }) => [stageKey, roleKey, outcome?.status]),
    ).toEqual([["set-up-test-targets", "devops", "done"]]);
    expect(pipelines.stageThreads.requests[0]?.work).toContain(
      "End with change_project_settings, giving every target at once; your Role card's Authority rules it, so it may come back as a Proposal the user applies with a click.",
    );
    expect(pipelines.tasks.changes.filter((change) => change.taskId === taskId)).toEqual([
      { taskId, state: "done" },
    ]);
    expect(pipelines.commands.ran).toEqual([]);
    expect(pipelines.publishing.published).toEqual([]);
  });
});
