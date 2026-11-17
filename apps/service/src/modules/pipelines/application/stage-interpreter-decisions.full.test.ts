import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { EventBus } from "../../../platform/events/event-bus.js";
import { DecisionAnswered } from "../../conversations/index.js";
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
  walkStages,
} from "../pipelines-application.fixtures.js";
import { aTaskRecord } from "../ports/pipelines-ports.fixtures.js";
import { StageInterpreter } from "./stage-interpreter.js";
import {
  scriptStage,
  draft,
  agentDone,
  A_WAITING,
  pipelines,
  aStageThread,
  startWith,
  failing,
  statusesOf,
  onWaiting,
  answerFirstOption,
  statesOf,
  ARCHITECT,
  hireTheArchitect,
  failuresPutTo,
} from "../stage-interpreter-decisions.fixtures.js";

afterEach(async () => {
  await pipelines.app.close();
});

describe("StageInterpreter's Decisions", () => {
  describe("a branch moved outside The Office", () => {
    const moved = "a".repeat(40);
    const branch = aTaskRecord().worktree.branch;

    /** A Stage that waits on its Agent's Decision, the branch moved meanwhile. */
    async function movedWhileWaiting(options: { alongBase: boolean }): Promise<{
      taskId: string;
      asked: ReturnType<typeof anAskedDecision>;
    }> {
      await startWith(A_WAITING, agentDone);
      const asked = anAskedDecision();
      asksOnce(pipelines, asked);
      const taskId = await walkStages(pipelines, [draft]);
      pipelines.git.move(taskId, { commit: moved, branch });
      if (options.alongBase) pipelines.git.movesAlongBase.add(taskId);
      return { taskId, asked };
    }

    it("takes a move along the base and tells the Agent, asking nobody", async () => {
      const { taskId, asked } = await movedWhileWaiting({ alongBase: true });

      await answerAsked(pipelines, taskId, asked, { kind: "option", option: 0 });

      expect(pipelines.stageThreads.requests.at(-1)?.work).toContain(
        "The Task's branch moved from ",
      );
      expect(pipelines.decisions.on(taskId)).toEqual([]);
      expect(await statusesOf(taskId)).toEqual([
        ["draft", "needs-decision"],
        ["draft", "done"],
      ]);
    });

    it("runs the Stage from the branch as it is once the user keeps it", async () => {
      const { taskId, asked } = await movedWhileWaiting({ alongBase: false });
      await answerAsked(pipelines, taskId, asked, { kind: "option", option: 0 });

      await answerLastDecision(pipelines, taskId, { kind: "option", option: 0 });

      expect(pipelines.stageThreads.requests).toHaveLength(2);
      expect(await statusesOf(taskId)).toEqual([
        ["draft", "needs-decision"],
        ["draft", "failed"],
        ["draft", "done"],
      ]);
      expect(statesOf(taskId).at(-1)).toBe("done");
    });

    it("asks again when the user said they put the branch back, and didn't", async () => {
      const { taskId, asked } = await movedWhileWaiting({ alongBase: false });
      await answerAsked(pipelines, taskId, asked, { kind: "option", option: 0 });

      await answerLastDecision(pipelines, taskId, { kind: "option", option: 1 });

      expect(pipelines.decisions.on(taskId)).toHaveLength(2);
      expect(pipelines.stageThreads.requests).toHaveLength(1);
    });
  });

  describe("a round limit", () => {
    const measure = scriptStage("measure", { goBackTo: "draft", rounds: 1 });

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

    it("goes on when the answer came before the run kept the Decision, so DecisionAnswered found no run", async () => {
      await startWith(agentDone, agentDone, agentDone);
      failing("2 tests fail.", "Still 2.");
      onWaiting("before", (taskId) => {
        const opened = pipelines.decisions.on(taskId).at(-1);
        if (opened) pipelines.decisions.answers.set(opened.id, { kind: "option", option: 0 });
        return Promise.resolve();
      });

      const taskId = await walkStages(pipelines, [draft, measure]);
      await pipelines.app.get(StageInterpreter, { strict: false }).walked(taskId);

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

  describe("whoever holds Asked first when a Stage runs out of tries", () => {
    const measure = scriptStage("measure", { goBackTo: "draft", rounds: 1 });

    it("asks the user when the Stage its holder sent back fails again", async () => {
      await startWith(agentDone, agentDone, agentDone);
      hireTheArchitect();
      const failures = failuresPutTo();
      failing("2 tests fail.", "Still 2.", "Still 2 after the clock.");
      const taskId = await walkStages(pipelines, [draft, measure]);

      await answerLastDecision(pipelines, taskId, {
        kind: "free-answer",
        text: "Mock the clock.",
        answeredBy: ARCHITECT,
      });

      const [toTheHolder, toTheUser] = pipelines.decisions.on(taskId);
      expect(toTheHolder?.putTo).toBe(ARCHITECT);
      expect(toTheUser?.putTo).toBeUndefined();
      expect(failures).toEqual([ARCHITECT, undefined]);
      expect(statesOf(taskId).at(-1)).toBe("waiting-on-you");
    });

    it("asks the user while nobody holds it", async () => {
      await startWith(agentDone, agentDone);
      hireTheArchitect({ holdsAskedFirst: false });
      const failures = failuresPutTo();
      failing("2 tests fail.", "Still 2.");

      const taskId = await walkStages(pipelines, [draft, measure]);

      expect(pipelines.decisions.on(taskId)[0]?.putTo).toBeUndefined();
      expect(failures).toEqual([undefined]);
    });

    it("asks the user when its holder can't be consulted", async () => {
      await startWith(agentDone, agentDone);
      pipelines.people.holders.set("asked-first-when-out-of-tries", ARCHITECT);
      const failures = failuresPutTo();
      failing("2 tests fail.", "Still 2.");

      await walkStages(pipelines, [draft, measure]);

      expect(failures).toEqual([undefined]);
    });
  });

  describe("a Decision the Agent opened with an Office tool", () => {
    const waiting = anAgentSession(A_WAITING_RESULT);

    it("waits on it whatever status the result gives, with no correction asked", async () => {
      await startWith(anAgentSession({ status: "done", summary: "Asked." }), agentDone);
      asksOnce(pipelines, anAskedDecision());

      const taskId = await walkStages(pipelines, [draft]);

      expect(await statusesOf(taskId)).toEqual([["draft", "needs-decision"]]);
      expect(pipelines.stageThreads.sent).toEqual([]);
    });

    it("takes the answer from Conversations' DecisionAnswered, once", async () => {
      await startWith(waiting, agentDone);
      const asked = anAskedDecision();
      asksOnce(pipelines, asked);
      const taskId = await walkStages(pipelines, [draft]);
      const answered = new DecisionAnswered(
        aStageThread(taskId),
        {
          id: asked.id,
          kind: "form",
          context: asked.context,
          questions: [
            {
              kind: "choice",
              question: asked.question,
              options: asked.options,
              recommendation: asked.recommendation,
            },
          ],
          threadId: (await runsOf(pipelines, taskId))[0]?.threadId ?? "",
          taskId,
          roleKey: "developer",
          attachmentIds: [],
          askedAt: new Date(),
          passedOn: [],
          answer: {
            kind: "submitted",
            answers: [{ kind: "option", option: 0 }],
            answeredAt: new Date(),
          },
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

    it("takes an answer the user gave while the Stage still ran, before its run kept the Decision", async () => {
      await startWith(waiting, agentDone);
      const asked = anAskedDecision();
      asksOnce(pipelines, asked);
      // Given in Conversations as the Agent's turn ran: its DecisionAnswered found no run to take it.
      pipelines.decisions.answers.set(asked.id, { kind: "free-answer", text: "Both pages." });

      const taskId = await walkStages(pipelines, [draft]);

      expect(await statusesOf(taskId)).toEqual([
        ["draft", "needs-decision"],
        ["draft", "done"],
      ]);
      expect(pipelines.stageThreads.requests.at(-1)?.work).toContain("Their answer: Both pages.");
      expect(statesOf(taskId)).toEqual(["done"]);
    });
  });

  describe("the Definition of Done", () => {
    it("is Done when the user marks it Done anyway", async () => {
      await startWith(anAgentSession(aDoneResult("Half.", "The rest.", [2])));
      const taskId = await walkStages(pipelines, [draft]);

      await answerLastDecision(pipelines, taskId, { kind: "option", option: 1 });

      expect(statesOf(taskId)).toEqual(["waiting-on-you", "in-progress", "done"]);
    });
  });

  describe("a budget", () => {
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

    it("keeps the run's context after its last turn, for its Thread tab once it ended", async () => {
      await startWith(agentDone);
      pipelines.stageThreads.contextAfterTurn = { tokens: 132_000, window: 200_000 };

      const taskId = await walkStages(pipelines, [draft]);

      const [run] = await runsOf(pipelines, taskId);
      expect(run?.context).toEqual({ tokens: 132_000, window: 200_000 });
    });
  });

  describe("an optional Stage", () => {
    const review = anAgentStage("review", { optional: true });

    it("is passed by, with no run, when every statement of the Definition of Done is already reported met", async () => {
      await startWith(agentDone);

      const taskId = await walkStages(pipelines, [draft, review]);

      const runs = await runsOf(pipelines, taskId);
      expect(runs.map(({ stageKey, outcome }) => [stageKey, outcome?.status])).toEqual([
        ["draft", "done"],
      ]);
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
