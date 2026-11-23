import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { EventBus } from "../../../platform/events/event-bus.js";
import { TaskPaused, TaskResumed } from "../../work/index.js";
import { choiceCondition, plainRoute, type Route } from "../domain/route.js";
import type { Stage } from "../domain/stage.js";
import {
  aDoneResult,
  anAgentSession,
  anAgentStage,
  runsOf,
  startPipelinesApplication,
  walkStages,
  type PipelinesApplication,
} from "../pipelines-application.fixtures.js";
import { StageInterpreter } from "./stage-interpreter.js";
import {
  StageRouteChoices,
  type AskedRouteChoice,
  type StageRouteChoiceAnswer,
} from "./stage-route-choices.js";

const SESSION = "the-stage's-session";
const toFix: Route = {
  to: "implement",
  condition: choiceCondition("the review found something to fix"),
  limit: 1,
};
const implement = anAgentStage("implement", { name: "Implement", routes: [plainRoute("review")] });
const review = anAgentStage("review", { name: "Review", routes: [toFix, plainRoute(null)] });
let pipelines: PipelinesApplication;

afterEach(async () => {
  await pipelines.app.close();
});

/**
 * Walks `stages`, the Agent of each run of the Stage named `stageName` choosing as `asks` says in
 * its turn, and returns each run's answers in order.
 */
async function chosenDuring(
  stages: readonly Stage[],
  stageName: string,
  asks: readonly AskedRouteChoice[],
  taskId: string = randomUUID(),
): Promise<StageRouteChoiceAnswer[][]> {
  pipelines.stageThreads.taskOfSession.set(SESSION, taskId);
  const tool = pipelines.app.get(StageRouteChoices, { strict: false });
  const answers: StageRouteChoiceAnswer[][] = [];
  pipelines.stageThreads.whileWorking = async ({ stageName: working }) => {
    if (working !== stageName) return;
    const these: StageRouteChoiceAnswer[] = [];
    for (const asked of asks) these.push(await tool.inSession(SESSION, asked));
    answers.push(these);
  };
  await walkStages(pipelines, stages, taskId);
  return answers;
}

describe("StageRouteChoices", () => {
  it("refuses a session on no running Stage", async () => {
    pipelines = await startPipelinesApplication();
    const tool = pipelines.app.get(StageRouteChoices, { strict: false });

    await expect(
      tool.inSession("a chat's session", { route: "implement", reason: "Why not." }),
    ).resolves.toEqual({
      text: "This tool works in a running Agent Stage of a Task, and this session is in none.",
      isError: true,
    });
  });

  it("refuses on a Stage with no choice rows", async () => {
    pipelines = await startPipelinesApplication([anAgentSession(aDoneResult())]);

    const [[answer] = []] = await chosenDuring(
      [anAgentStage("implement", { name: "Implement", routes: [plainRoute(null)] })],
      "Implement",
      [{ route: "end", reason: "Done." }],
    );

    expect(answer).toEqual({
      text: "This Stage has no routes for you to choose: The Office weighs its routes itself as it ends.",
      isError: true,
    });
  });

  it("refuses a route that isn't a choice row, its Otherwise's target too, naming the choices", async () => {
    pipelines = await startPipelinesApplication([
      anAgentSession(aDoneResult()),
      anAgentSession(aDoneResult()),
    ]);
    const taskId = randomUUID();

    const [[toEnd, blank] = []] = await chosenDuring(
      [implement, review],
      "Review",
      [
        { route: "end", reason: "Nothing is left." },
        { route: "implement", reason: "  " },
      ],
      taskId,
    );

    expect(toEnd).toEqual({
      text: '"end" isn\'t one of this Stage\'s choices: The Office weighs its other routes itself. Choose one of these by its key: implement ("the review found something to fix").',
      isError: true,
    });
    expect(blank).toEqual({
      text: "Give your reason for the route, in a sentence or two.",
      isError: true,
    });
    const runs = await runsOf(pipelines, taskId);
    expect(runs.map(({ choice }) => choice)).toEqual([undefined, undefined]);
  });

  it("keeps the last choice on the run, and says when the chosen route's limit ran out", async () => {
    pipelines = await startPipelinesApplication([
      anAgentSession(aDoneResult()),
      anAgentSession(aDoneResult()),
      anAgentSession(aDoneResult()),
      anAgentSession(aDoneResult()),
    ]);
    const taskId = randomUUID();

    const [first, second] = await chosenDuring(
      [implement, review],
      "Review",
      [
        { route: "implement", reason: "First thought." },
        { route: " implement ", reason: " The dialog loses its focus. " },
      ],
      taskId,
    );

    expect(first?.map(({ text }) => text)).toEqual([
      "Chose Implement: First thought.",
      "Chose Implement: The dialog loses its focus.",
    ]);
    expect(second?.[1]).toEqual({
      text: "Chose Implement: The dialog loses its focus. Its limit ran out (followed 1 of at most 1 time): as this Stage ends done, the walk stops before following it and asks the user whether to follow it once more.",
      isError: false,
    });
    const runs = await runsOf(pipelines, taskId);
    expect(runs.map(({ stageKey, choice }) => [stageKey, choice])).toEqual([
      ["implement", undefined],
      ["review", { to: "implement", reason: "The dialog loses its focus." }],
      ["implement", undefined],
      ["review", { to: "implement", reason: "The dialog loses its focus." }],
    ]);
    expect(runs.at(-1)?.decisions.map(({ kind }) => kind)).toEqual(["route-limit"]);
  });

  it("keeps a held run's choice on the run that resumes it, its message naming it", async () => {
    pipelines = await startPipelinesApplication([
      anAgentSession(aDoneResult()),
      anAgentSession(aDoneResult()),
    ]);
    const taskId = randomUUID();
    const reviewFirst = anAgentStage("review", {
      name: "Review",
      routes: [
        { to: null, condition: choiceCondition("nothing is left to do"), limit: null },
        plainRoute("implement"),
      ],
    });
    const tool = pipelines.app.get(StageRouteChoices, { strict: false });
    pipelines.stageThreads.taskOfSession.set(SESSION, taskId);
    pipelines.stageThreads.whileWorking = async () => {
      pipelines.stageThreads.whileWorking = undefined;
      await tool.inSession(SESSION, { route: "end", reason: "The change is complete." });
      pipelines.tasks.put(taskId, { state: "paused", pipelineId: "for-tests" });
      void pipelines.app
        .get(EventBus)
        .publish(new TaskPaused(taskId, "in-progress", "user", undefined, undefined));
    };

    await walkStages(
      pipelines,
      [reviewFirst, anAgentStage("implement", { routes: [plainRoute(null)] })],
      taskId,
    );
    pipelines.tasks.put(taskId, { state: "in-progress", pipelineId: "for-tests" });
    await pipelines.app.get(EventBus).publish(new TaskResumed(taskId));
    await pipelines.app.get(StageInterpreter, { strict: false }).walked(taskId);

    const choice = { to: null, reason: "The change is complete." };
    const runs = await runsOf(pipelines, taskId);
    expect(runs.map(({ stageKey, outcome }) => [stageKey, outcome?.status])).toEqual([
      ["review", "failed"],
      ["review", "done"],
    ]);
    expect(runs.map((run) => run.choice)).toEqual([choice, choice]);
    expect(pipelines.stageThreads.requests[1]?.work).toContain(
      "You already chose the route to End: The change is complete.",
    );
  });
});
