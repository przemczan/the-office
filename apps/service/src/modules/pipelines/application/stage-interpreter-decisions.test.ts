import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { EventBus } from "../../../platform/events/event-bus.js";
import { DecisionAnswered } from "../../conversations/index.js";
import type { SessionScript } from "../../engine/index.js";
import type { OnFailure, Stage } from "../domain/stage.js";
import {
  A_WAITING_RESULT,
  aDoneResult,
  anAgentSession,
  anAskedDecision,
  answerAsked,
  anAgentStage,
  answerLastDecision,
  asksOnce,
  aTurn,
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

/** Runs `meanwhile` as the walk moves a Task to Waiting on you, before or after the move lands. */
function onWaiting(when: "before" | "after", meanwhile: (taskId: string) => Promise<void>): void {
  const { tasks } = pipelines;
  const changeState = tasks.changeState.bind(tasks);
  tasks.changeState = async (taskId, state) => {
    const waiting = state === "waiting-on-you";
    if (waiting && when === "before") await meanwhile(taskId);
    const task = await changeState(taskId, state);
    if (waiting && when === "after") await meanwhile(taskId);
    return task;
  };
}

/** Takes the first option of the Task's latest Decision, as the user's click would. */
async function answerFirstOption(taskId: string): Promise<void> {
  const decision = pipelines.decisions.on(taskId).at(-1);
  if (!decision) throw new Error("The Decision isn't open yet.");
  await pipelines.app
    .get(StageInterpreter, { strict: false })
    .takeAnswer(taskId, decision.id, { kind: "option", option: 0 });
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

    it("opens the Decision before the Task waits on the user", async () => {
      await startWith(agentDone, agentDone);
      failing("2 tests fail.", "Still 2.");
      const decisionsWhenWaiting: number[] = [];
      onWaiting("before", (taskId) => {
        decisionsWhenWaiting.push(pipelines.decisions.on(taskId).length);
        return Promise.resolve();
      });

      await walkStages(pipelines, [draft, measure]);

      expect(decisionsWhenWaiting).toEqual([1]);
    });

    it.each(["before", "after"] as const)(
      "goes on when the answer came %s the Task was Waiting on you, while the walk was ending",
      async (when) => {
        await startWith(agentDone, agentDone, agentDone);
        failing("2 tests fail.", "Still 2.");
        onWaiting(when, answerFirstOption);

        const taskId = await walkStages(pipelines, [draft, measure]);
        await pipelines.app.get(StageInterpreter, { strict: false }).walked(taskId);

        expect(statesOf(taskId)).toEqual(["waiting-on-you", "in-progress", "done"]);
      },
    );

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

  describe("a Decision the Agent opened with an Office tool", () => {
    const waiting = anAgentSession(A_WAITING_RESULT);

    it("is the walk's to wait on, opened once, with the Handover note kept", async () => {
      await startWith(waiting, agentDone);
      const asked = anAskedDecision({ options: ["Allow once", "Deny"] });
      asksOnce(pipelines, asked);

      const taskId = await walkStages(pipelines, [draft]);

      const [run] = await runsOf(pipelines, taskId);
      expect(run?.outcome).toEqual({
        status: "needs-decision",
        question: asked.question,
        context: asked.context,
        options: asked.options,
        recommendation: asked.recommendation,
        handoverNote: "Waiting on the user.",
      });
      expect(run?.decisions).toEqual([
        {
          id: asked.id,
          kind: "agent",
          question: asked.question,
          options: [
            { kind: "answered", answer: "Allow once" },
            { kind: "answered", answer: "Deny" },
          ],
          answer: undefined,
        },
      ]);
      // Conversations opened it as the tool ran: the walk opens none.
      expect(pipelines.decisions.on(taskId)).toEqual([]);
      expect(statesOf(taskId)).toEqual(["waiting-on-you"]);
    });

    it("waits on it whatever status the result gives, with no correction asked", async () => {
      await startWith(anAgentSession({ status: "done", summary: "Asked." }), agentDone);
      asksOnce(pipelines, anAskedDecision());

      const taskId = await walkStages(pipelines, [draft]);

      expect(await statusesOf(taskId)).toEqual([["draft", "needs-decision"]]);
      expect(pipelines.stageThreads.sent).toEqual([]);
    });

    it("runs the Stage again in the asking Thread through the Context policy with the answer, whatever the Stage declares", async () => {
      await startWith(waiting, agentDone);
      const asked = anAskedDecision();
      asksOnce(pipelines, asked);
      const taskId = await walkStages(pipelines, [anAgentStage("draft", { session: "fresh" })]);
      const [run] = await runsOf(pipelines, taskId);

      await answerAsked(pipelines, taskId, asked, { kind: "free-answer", text: "Both pages." });

      const again = pipelines.stageThreads.requests.at(-1);
      expect(again?.declared).toBeUndefined();
      expect(again?.previousThreadId).toBe(run?.threadId);
      expect(again?.work).toContain(
        "## Your question, answered\n\nYou asked the user: Which page?\n\nTheir answer: Both pages.",
      );
      expect(await statusesOf(taskId)).toEqual([
        ["draft", "needs-decision"],
        ["draft", "done"],
      ]);
      expect(statesOf(taskId)).toEqual(["waiting-on-you", "in-progress", "done"]);
    });

    it("takes the answer from Conversations' DecisionAnswered, once", async () => {
      await startWith(waiting, agentDone);
      const asked = anAskedDecision();
      asksOnce(pipelines, asked);
      const taskId = await walkStages(pipelines, [draft]);
      const answered = new DecisionAnswered(
        aStageThread(taskId),
        {
          ...asked,
          threadId: (await runsOf(pipelines, taskId))[0]?.threadId ?? "",
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

  describe("a budget", () => {
    it("asks to raise it when the Task's tokens reached it before the Stage's first engine call", async () => {
      await startWith(agentDone);
      const taskId = randomUUID();
      pipelines.usage.tokens.set(taskId, 150_000);

      await walkStages(pipelines, [draft], taskId);

      const [run] = await runsOf(pipelines, taskId);
      expect(run?.outcome).toMatchObject({
        status: "failed",
        budgetReached: { used: 150_000, budget: 100_000 },
      });
      expect(pipelines.stageThreads.requests).toEqual([]);
      expect(pipelines.decisions.on(taskId)[0]?.draft.options).toEqual([
        "Raise it to 250k",
        "Drop the Task",
      ]);
      expect(pipelines.published).toContainEqual(
        expect.objectContaining({ stageKey: "draft", used: 150_000, budget: 100_000 }),
      );

      await answerLastDecision(pipelines, taskId, { kind: "option", option: 0 });

      expect(await statusesOf(taskId)).toEqual([
        ["draft", "failed"],
        ["draft", "done"],
      ]);
      expect(statesOf(taskId)).toEqual(["waiting-on-you", "in-progress", "done"]);
    });

    it("checks it again before the correction, which then isn't sent", async () => {
      await startWith([
        { step: "start", brief: { id: "brief", text: "" } },
        aTurn({ status: "done", summary: "No note." }),
        { step: "end" },
      ]);
      const taskId = randomUUID();
      let reads = 0;
      pipelines.usage.observe = () => {
        reads += 1;
        if (reads === 2) pipelines.usage.tokens.set(taskId, 120_000);
      };

      await walkStages(pipelines, [draft], taskId);

      const [run] = await runsOf(pipelines, taskId);
      expect(reads).toBe(2);
      expect(run?.outcome).toMatchObject({ status: "failed", budgetReached: { used: 120_000 } });
      expect(pipelines.stageThreads.sent).toEqual([]);
      expect(pipelines.git.commits.at(-1)?.message).toContain("budget");
    });

    it("records each run's tokens, turn by turn", async () => {
      await startWith(agentDone);

      const taskId = await walkStages(pipelines, [draft]);

      const [run] = await runsOf(pipelines, taskId);
      expect(run?.tokens).toEqual({ input: 10, output: 10, cacheRead: 0, cacheCreation: 0 });
    });
  });

  describe("an optional Stage", () => {
    const review = anAgentStage("review", { optional: true });

    it("is skipped when every statement of the Definition of Done is already reported met", async () => {
      await startWith(agentDone);

      const taskId = await walkStages(pipelines, [draft, review]);

      const runs = await runsOf(pipelines, taskId);
      expect(runs.map(({ stageKey, outcome }) => [stageKey, outcome?.status])).toEqual([
        ["draft", "done"],
        ["review", "done"],
      ]);
      expect(runs[1]?.outcome).toMatchObject({ summary: expect.stringContaining("Skipped") });
      expect(pipelines.stageThreads.requests).toHaveLength(1);
      expect(statesOf(taskId)).toEqual(["done"]);
    });

    it("runs while a statement isn't reported met", async () => {
      await startWith(anAgentSession(aDoneResult("Half.", "The rest.", [2])), agentDone);

      const taskId = await walkStages(pipelines, [draft, review]);

      expect(pipelines.stageThreads.requests).toHaveLength(2);
      expect(statesOf(taskId)).toEqual(["done"]);
    });
  });
});
