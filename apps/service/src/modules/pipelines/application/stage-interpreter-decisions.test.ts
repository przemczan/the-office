import { afterEach, describe, expect, it } from "vitest";
import { EventBus } from "../../../platform/events/event-bus.js";
import { DecisionAnswered } from "../../conversations/index.js";
import type { SessionScript } from "../../engine/index.js";
import type { OnFailure, Stage } from "../domain/stage.js";
import {
  aDoneResult,
  anAgentSession,
  anAgentStage,
  answerLastDecision,
  runsOf,
  startPipelinesApplication,
  walkStages,
  type PipelinesApplication,
} from "../pipelines-application.fixtures.js";
import { aCommandRun } from "../ports/pipelines-ports.fixtures.js";
import { StageInterpreter } from "./stage-interpreter.js";

function scriptStage(key: string, onFailure?: OnFailure): Stage {
  return {
    kind: "script",
    key,
    name: key,
    optional: false,
    command: "test",
    ...(onFailure && { onFailure }),
  };
}

const draft = anAgentStage("draft");
const agentDone = anAgentSession(aDoneResult());
const asking = anAgentSession({
  status: "needs_decision",
  summary: "Asked which page.",
  decision: {
    question: "Which page?",
    context: "Both list devices.",
    options: ["The device page", "The list"],
    recommendation: { option: 0, reason: "It has the room." },
  },
});

let pipelines: PipelinesApplication;

/** The Stage Thread a DecisionAnswered tells of, as Conversations keeps it. */
function aStageThread(taskId: string): ConstructorParameters<typeof DecisionAnswered>[0] {
  return {
    id: "8f0b1a52-3c1e-4a4e-9d0e-1f5b6c7d8e9f",
    home: { kind: "task", taskId },
    roleKey: "developer",
    title: "draft · Ada",
    state: "waiting",
    session: undefined,
    override: undefined,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
    startedAt: new Date(),
    openDecision: undefined,
    stageThread: true,
  };
}

afterEach(async () => {
  await pipelines.app.close();
});

async function startWith(...scripts: SessionScript[]): Promise<void> {
  pipelines = await startPipelinesApplication(scripts);
}

/** The next Script Stages' commands fail, printing these, in order. */
function failing(...printed: string[]): void {
  pipelines.commands.commandRuns.push(
    ...printed.map((output) => [aCommandRun("npm test", "failed", output)]),
  );
}

async function statusesOf(taskId: string): Promise<[string, string | undefined][]> {
  const runs = await runsOf(pipelines, taskId);
  return runs.map(({ stageKey, outcome }) => [stageKey, outcome?.status]);
}

function statesOf(taskId: string): string[] {
  return pipelines.tasks.changes
    .filter((change) => change.taskId === taskId)
    .map(({ state }) => state);
}

describe("StageInterpreter's Decisions", () => {
  describe("a round limit", () => {
    const measure = scriptStage("measure", { goBackTo: "draft", rounds: 1 });

    it("asks the user in the last Agent Stage's Thread, as The Office", async () => {
      await startWith(agentDone, agentDone);
      failing("2 tests fail.", "Still 2.");

      const taskId = await walkStages(pipelines, [draft, measure]);

      const [decision] = pipelines.decisions.on(taskId);
      const runs = await runsOf(pipelines, taskId);
      expect(decision).toMatchObject({
        threadId: runs[2]?.threadId,
        byTheOffice: true,
        draft: {
          question: '"measure" failed, and its rounds are used up. What now?',
          options: ["Allow 1 more round", "Continue with the issues recorded", "Drop the Task"],
        },
      });
      expect(decision?.draft.context).toContain("Still 2.");
      expect(runs[3]?.decisions).toEqual([
        {
          id: decision?.id,
          kind: "no-retries-left",
          options: [
            { kind: "more-rounds", rounds: 1 },
            { kind: "accept-issues" },
            { kind: "drop" },
          ],
          answer: undefined,
        },
      ]);
      expect(statesOf(taskId)).toEqual(["waiting-on-you"]);
    });

    it("goes back for the rounds the user allows, and on to Done", async () => {
      await startWith(agentDone, agentDone, agentDone);
      failing("2 tests fail.", "Still 2.");
      const taskId = await walkStages(pipelines, [draft, measure]);

      await answerLastDecision(pipelines, taskId, { kind: "option", option: 0 });

      expect(await statusesOf(taskId)).toEqual([
        ["draft", "done"],
        ["measure", "failed"],
        ["draft", "done"],
        ["measure", "failed"],
        ["draft", "done"],
        ["measure", "done"],
      ]);
      const runs = await runsOf(pipelines, taskId);
      expect(runs[4]?.carriedFailure).toMatchObject({ round: 2, rounds: 2 });
      expect(statesOf(taskId)).toEqual(["waiting-on-you", "in-progress", "done"]);
    });

    it("gives one more round with the user's own words in the next Brief", async () => {
      await startWith(agentDone, agentDone, agentDone);
      failing("2 tests fail.", "Still 2.");
      const taskId = await walkStages(pipelines, [draft, measure]);

      await answerLastDecision(pipelines, taskId, { kind: "free-answer", text: "Mock the clock." });

      const work = pipelines.stageThreads.requests.at(-1)?.work;
      expect(work).toContain("Still 2.");
      expect(work).toContain("The user's guidance for this round:\n\nMock the clock.");
      expect(statesOf(taskId).at(-1)).toBe("done");
    });

    it("continues with the issues recorded, naming them in the next commit", async () => {
      await startWith(agentDone, agentDone);
      failing("2 tests fail.");
      const taskId = await walkStages(pipelines, [
        draft,
        scriptStage("measure"),
        anAgentStage("proof"),
      ]);

      await answerLastDecision(pipelines, taskId, { kind: "option", option: 1 });

      expect(await statusesOf(taskId)).toEqual([
        ["draft", "done"],
        ["measure", "failed"],
        ["proof", "done"],
      ]);
      expect(pipelines.git.commits.at(-1)?.message).toContain(
        "Issues the user accepted:\n- measure: `npm test` failed",
      );
      expect(statesOf(taskId)).toEqual(["waiting-on-you", "in-progress", "done"]);
    });

    it("drops the Task when the user drops it", async () => {
      await startWith(agentDone);
      failing("2 tests fail.");
      const taskId = await walkStages(pipelines, [draft, scriptStage("measure")]);

      await answerLastDecision(pipelines, taskId, { kind: "option", option: 2 });

      expect(await statusesOf(taskId)).toHaveLength(2);
      expect(statesOf(taskId)).toEqual(["waiting-on-you", "in-progress", "dropped"]);
    });
  });

  describe("an Agent's question", () => {
    it("opens it in the Stage's Thread as the Agent's, and runs the Stage again once answered", async () => {
      await startWith(asking, agentDone);
      const taskId = await walkStages(pipelines, [draft]);
      const [asked] = await runsOf(pipelines, taskId);

      expect(pipelines.decisions.on(taskId)).toEqual([
        expect.objectContaining({
          threadId: asked?.threadId,
          byTheOffice: false,
          draft: expect.objectContaining({ question: "Which page?" }),
        }),
      ]);

      await answerLastDecision(pipelines, taskId, { kind: "option", option: 1 });

      expect(await statusesOf(taskId)).toEqual([
        ["draft", "needs-decision"],
        ["draft", "done"],
      ]);
      expect(statesOf(taskId)).toEqual(["waiting-on-you", "in-progress", "done"]);
    });

    it("takes the answer from Conversations' DecisionAnswered, once", async () => {
      await startWith(asking, agentDone);
      const taskId = await walkStages(pipelines, [draft]);
      const [opened] = pipelines.decisions.on(taskId);
      if (!opened) throw new Error("No Decision was opened.");
      const answered = new DecisionAnswered(
        aStageThread(taskId),
        {
          ...opened.draft,
          id: opened.id,
          threadId: opened.threadId ?? "",
          taskId,
          roleKey: "developer",
          askedAt: new Date(),
          answer: { kind: "option", option: 0, answeredAt: new Date() },
        },
        new Date(),
      );

      await pipelines.app.get(EventBus).publish(answered);
      await pipelines.app.get(StageInterpreter, { strict: false }).walked(taskId);
      await pipelines.app.get(EventBus).publish(answered);

      expect(await statusesOf(taskId)).toEqual([
        ["draft", "needs-decision"],
        ["draft", "done"],
      ]);
    });
  });

  describe("the Definition of Done", () => {
    it("is Done when the Pipeline completes with it reported met", async () => {
      await startWith(agentDone);

      const taskId = await walkStages(pipelines, [draft]);

      expect(pipelines.decisions.on(taskId)).toEqual([]);
      expect(statesOf(taskId)).toEqual(["done"]);
    });

    it("asks the user when it isn't, and runs the last Agent Stage once more with what is left", async () => {
      await startWith(anAgentSession(aDoneResult("Half.", "The rest.", [2])), agentDone);
      const taskId = await walkStages(pipelines, [draft, scriptStage("measure")]);

      const [decision] = pipelines.decisions.on(taskId);
      expect(decision?.draft.options).toEqual([
        'Run "draft" once more',
        "Mark the Task Done",
        "Drop the Task",
      ]);
      expect(decision?.draft.context).toContain(
        "Not reported met:\n- The new name shows on the list",
      );
      expect(statesOf(taskId)).toEqual(["waiting-on-you"]);

      await answerLastDecision(pipelines, taskId, { kind: "option", option: 0 });

      expect(await statusesOf(taskId)).toEqual([
        ["draft", "done"],
        ["measure", "done"],
        ["draft", "done"],
        ["measure", "done"],
      ]);
      expect(pipelines.stageThreads.requests.at(-1)?.work).toContain(
        "The Definition of Done isn't reported met:\n- The new name shows on the list",
      );
      expect(statesOf(taskId)).toEqual(["waiting-on-you", "in-progress", "done"]);
    });

    it("is Done when the user marks it Done anyway", async () => {
      await startWith(anAgentSession(aDoneResult("Half.", "The rest.", [2])));
      const taskId = await walkStages(pipelines, [draft]);

      await answerLastDecision(pipelines, taskId, { kind: "option", option: 1 });

      expect(statesOf(taskId)).toEqual(["waiting-on-you", "in-progress", "done"]);
    });
  });
});
