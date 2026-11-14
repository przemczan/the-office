import { afterEach, describe, expect, it } from "vitest";
import { EventBus } from "../../../platform/events/event-bus.js";
import { DutyHolderChanged } from "../../people/index.js";
import type { Stage } from "../domain/stage.js";
import {
  aDoneResult,
  anAgentSession,
  anAgentStage,
  startPipelinesApplication,
  walkStages,
  type PipelinesApplication,
} from "../pipelines-application.fixtures.js";
import { aPerson } from "../ports/pipelines-ports.fixtures.js";
import { StageRunRepository } from "../ports/stage-run-repository.js";
import { GateService } from "./gate-service.js";
import { StageInterpreter } from "./stage-interpreter.js";
import { TaskStagesService } from "./task-stages-service.js";

/** An Agent Stage naming Implements, which the Developer holds by default. */
function implementing(key: string): Stage {
  const { role: _developer, ...stage } = anAgentStage(key) as Extract<Stage, { kind: "agent" }>;
  return { ...stage, duty: "implements" };
}

const draft = implementing("draft");
const look: Stage = { kind: "gate", key: "look", name: "Look", optional: false };
const polish = implementing("polish");

let pipelines: PipelinesApplication;

afterEach(async () => {
  await pipelines.app.close();
});

async function rolesOfRuns(taskId: string): Promise<(string | undefined)[][]> {
  const runs = await pipelines.app.get(StageRunRepository, { strict: false }).list(taskId);
  return runs.map(({ stageKey, roleKey }) => [stageKey, roleKey]);
}

/** Implements goes to the Architect, whom Archie fills, as Settings › Duties would save it. */
async function implementsGoesToTheArchitect(): Promise<void> {
  pipelines.people.people.set("architect", aPerson("Archie"));
  pipelines.people.holders.set("implements", "architect");
  await pipelines.app
    .get(EventBus)
    .publish(new DutyHolderChanged("implements", "developer", "architect", new Date()));
}

describe("an Agent Stage naming a duty", () => {
  it("runs as whoever holds the duty when it starts, and its run records that Role", async () => {
    pipelines = await startPipelinesApplication([anAgentSession(aDoneResult())]);

    const taskId = await walkStages(pipelines, [draft]);

    expect(pipelines.stageThreads.requests.map(({ roleKey }) => roleKey)).toEqual(["developer"]);
    expect(await rolesOfRuns(taskId)).toEqual([["draft", "developer"]]);
  });

  it("keeps a started Stage's person after the duty changes hands, and gives a later Stage to the new holder", async () => {
    pipelines = await startPipelinesApplication([
      anAgentSession(aDoneResult()),
      anAgentSession(aDoneResult()),
    ]);
    const taskId = await walkStages(pipelines, [draft, look, polish]);

    await implementsGoesToTheArchitect();
    const progress = await pipelines.app.get(TaskStagesService).progress(taskId);
    expect(progress?.stages.map(({ stage, workedBy }) => [stage.key, workedBy])).toEqual([
      ["draft", "developer"],
      ["look", undefined],
      ["polish", "architect"],
    ]);

    await pipelines.app.get(GateService).continue(taskId);
    await pipelines.app.get(StageInterpreter).walked(taskId);

    expect(await rolesOfRuns(taskId)).toEqual([
      ["draft", "developer"],
      ["look", undefined],
      ["polish", "architect"],
    ]);
    expect(pipelines.stageThreads.requests.map(({ roleKey }) => roleKey)).toEqual([
      "developer",
      "architect",
    ]);
  });

  it("holds a started Task whose next Stage names a duty left unheld", async () => {
    pipelines = await startPipelinesApplication([anAgentSession(aDoneResult())]);
    const taskId = await walkStages(pipelines, [draft, look, polish]);

    pipelines.people.holders.set("implements", null);
    await pipelines.app
      .get(EventBus)
      .publish(new DutyHolderChanged("implements", "developer", null, new Date()));

    expect((await pipelines.tasks.read(taskId)).state).toBe("paused");
    expect(pipelines.tasks.holds).toEqual([
      {
        taskId,
        reason: expect.stringContaining("Stage 3 · polish: nobody holds Implements"),
      },
    ]);
  });

  it("is flagged by its holder let go", async () => {
    pipelines = await startPipelinesApplication([anAgentSession(aDoneResult())]);
    const taskId = await walkStages(pipelines, [draft, look, polish]);

    pipelines.people.people.delete("developer");
    pipelines.people.letGo.set("developer", "Ada");

    const problems = await pipelines.app.get(TaskStagesService).staffingProblems(taskId);
    expect(problems.map(({ text }) => text)).toEqual([
      "Stage 3 · polish: Ada was let go from developer, who holds Implements; hire Ada back, choose who holds it in Settings › Duties, or choose who works it.",
    ]);
  });
});
