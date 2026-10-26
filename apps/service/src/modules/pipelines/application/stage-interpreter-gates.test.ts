import { afterEach, describe, expect, it } from "vitest";
import { EventBus } from "../../../platform/events/event-bus.js";
import { TaskResumed } from "../../work/index.js";
import { GateRefused } from "../domain/gate-refused.js";
import type { Stage } from "../domain/stage.js";
import {
  GateContinued,
  GateDropped,
  GateReached,
  SentBackFromGate,
  WentBackToStage,
} from "../domain/stage-run-events.js";
import {
  aDoneResult,
  anAgentSession,
  anAgentStage,
  runsOf,
  startPipelinesApplication,
  walkStages,
  type PipelinesApplication,
} from "../pipelines-application.fixtures.js";
import { aCommandRun } from "../ports/pipelines-ports.fixtures.js";
import { GateService } from "./gate-service.js";
import { StageInterpreter } from "./stage-interpreter.js";
import { TaskStagesService } from "./task-stages-service.js";

const agentDone = anAgentSession(aDoneResult());
const FEEDBACK = "The button is too small to tap.";

const draft = anAgentStage("draft");
const measure: Stage = {
  kind: "script",
  key: "measure",
  name: "Measure",
  optional: false,
  command: "test",
  onFailure: { goBackTo: "draft", rounds: 1 },
};
const look: Stage = { kind: "gate", key: "look", name: "Look", optional: false };
const ship: Stage = {
  kind: "script",
  key: "ship",
  name: "Ship",
  optional: false,
  command: "build",
};

let pipelines: PipelinesApplication;

afterEach(async () => {
  await pipelines.app.close();
});

function gates(): GateService {
  return pipelines.app.get(GateService);
}

async function walked(taskId: string): Promise<void> {
  await pipelines.app.get(StageInterpreter).walked(taskId);
}

async function statusesOf(taskId: string): Promise<[string, string | undefined][]> {
  return (await runsOf(pipelines, taskId)).map(({ stageKey, outcome }) => [
    stageKey,
    outcome?.status,
  ]);
}

async function stateOf(taskId: string, stageKey: string): Promise<string | undefined> {
  const progress = await pipelines.app.get(TaskStagesService).progress(taskId);
  return progress?.find(({ stage }) => stage.key === stageKey)?.state;
}

function eventsOf(taskId: string): unknown[] {
  return pipelines.published.flatMap((event) => {
    if (event instanceof GateReached && event.taskId === taskId)
      return [["reached", event.stageKey]];
    if (event instanceof GateContinued && event.taskId === taskId) return [["continued"]];
    if (event instanceof GateDropped && event.taskId === taskId) return [["dropped"]];
    if (event instanceof SentBackFromGate && event.taskId === taskId) {
      return [["sent back", event.fromStageKey, event.toStageKey]];
    }
    if (event instanceof WentBackToStage && event.taskId === taskId) {
      return [["went back", event.fromStageKey, event.toStageKey, event.round, event.rounds]];
    }
    return [];
  });
}

describe("A Gate", () => {
  it("sets the Task Waiting on you, and Continue walks on to the end", async () => {
    pipelines = await startPipelinesApplication([agentDone]);

    const taskId = await walkStages(pipelines, [draft, look, ship]);

    expect(await statusesOf(taskId)).toEqual([
      ["draft", "done"],
      ["look", "done"],
    ]);
    expect(await stateOf(taskId, "look")).toBe("waiting-on-you");
    expect(pipelines.tasks.changes).toEqual([{ taskId, state: "waiting-on-you" }]);

    const after = await gates().continue(taskId);
    await walked(taskId);

    expect(after.find(({ stage }) => stage.key === "look")?.state).toBe("done");
    expect(await statusesOf(taskId)).toEqual([
      ["draft", "done"],
      ["look", "done"],
      ["ship", "done"],
    ]);
    expect(eventsOf(taskId)).toEqual([["reached", "look"], ["continued"]]);
    expect(pipelines.tasks.changes.map(({ state }) => state)).toEqual([
      "waiting-on-you",
      "in-progress",
      "done",
    ]);
  });

  it("sends the work back to the chosen Stage with the feedback in a fresh session, using no round", async () => {
    pipelines = await startPipelinesApplication([agentDone, agentDone, agentDone]);
    const taskId = await walkStages(pipelines, [draft, measure, look]);

    pipelines.commands.commandRuns.push([aCommandRun("npm test", "failed", "1 test fails.")]);
    await gates().sendBack(taskId, "draft", `  ${FEEDBACK}\n`);
    await walked(taskId);

    expect(await statusesOf(taskId)).toEqual([
      ["draft", "done"],
      ["measure", "done"],
      ["look", "done"],
      ["draft", "done"],
      ["measure", "failed"],
      ["draft", "done"],
      ["measure", "done"],
      ["look", "done"],
    ]);
    // The send back used none of the measure's one round.
    expect(eventsOf(taskId)).toEqual([
      ["reached", "look"],
      ["sent back", "look", "draft"],
      ["went back", "measure", "draft", 1, 1],
      ["reached", "look"],
    ]);
    const sentBackRun = (await runsOf(pipelines, taskId))[3];
    expect(sentBackRun?.sentBack).toEqual({ gateKey: "look", feedback: FEEDBACK });
    expect(sentBackRun?.carriedFailure).toBeUndefined();
    const request = pipelines.stageThreads.requests[1];
    expect(request?.previousThreadId).toBeUndefined();
    expect(request?.work).toContain(`## Sent back from Look`);
    expect(request?.work).toContain(FEEDBACK);
    expect(request?.work).not.toContain("Why this Stage runs again");
    expect(request?.record).not.toContain("Look (Gate)");
    expect(await stateOf(taskId, "look")).toBe("waiting-on-you");
  });

  it("drops the Task at the Gate", async () => {
    pipelines = await startPipelinesApplication([agentDone]);
    const taskId = await walkStages(pipelines, [draft, look, ship]);

    await gates().drop(taskId);
    await walked(taskId);

    expect(await statusesOf(taskId)).toEqual([
      ["draft", "done"],
      ["look", "done"],
    ]);
    expect(eventsOf(taskId)).toEqual([["reached", "look"], ["dropped"]]);
    expect(pipelines.tasks.changes.at(-1)).toEqual({ taskId, state: "dropped" });
  });

  it("keeps an action on a Paused Task for its Resume", async () => {
    pipelines = await startPipelinesApplication([agentDone]);
    const taskId = await walkStages(pipelines, [draft, look, ship]);
    pipelines.tasks.put(taskId, { state: "paused", pipelineId: "for-tests" });

    await gates().continue(taskId);
    await walked(taskId);
    expect(await statusesOf(taskId)).toHaveLength(2);

    pipelines.tasks.put(taskId, { state: "in-progress", pipelineId: "for-tests" });
    await pipelines.app.get(EventBus).publish(new TaskResumed(taskId));
    await walked(taskId);
    expect((await statusesOf(taskId)).at(-1)).toEqual(["ship", "done"]);
  });

  it("asks about the Definition of Done after Continue at the last Stage, and takes no second action", async () => {
    pipelines = await startPipelinesApplication([
      anAgentSession(aDoneResult("Done.", "None.", [])),
    ]);
    const taskId = await walkStages(pipelines, [draft, look]);

    await gates().continue(taskId);
    await walked(taskId);

    const gateRun = (await runsOf(pipelines, taskId)).at(-1);
    expect(gateRun?.decisions.map(({ kind }) => kind)).toEqual(["definition-of-done"]);
    expect(pipelines.tasks.changes.at(-1)).toEqual({ taskId, state: "waiting-on-you" });
    await expect(gates().continue(taskId)).rejects.toThrow(GateRefused);
  });

  it("refuses an action with every reason", async () => {
    pipelines = await startPipelinesApplication([agentDone]);
    const taskId = await walkStages(pipelines, [draft, measure, look, ship]);

    await expect(gates().sendBack(taskId, "measure", " ")).rejects.toThrow(
      new GateRefused([
        "Send the work back to an Agent Stage before the Gate.",
        "Say what should change before sending it back.",
      ]),
    );
    await expect(gates().sendBack(taskId, "ship", FEEDBACK)).rejects.toThrow(GateRefused);
    await gates().continue(taskId);
    await walked(taskId);
    await expect(gates().drop(taskId)).rejects.toThrow(
      new GateRefused(["The Task isn't waiting at a Gate."]),
    );
  });
});
