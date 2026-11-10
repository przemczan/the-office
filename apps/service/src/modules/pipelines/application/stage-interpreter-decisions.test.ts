import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { CTO } from "../../people/index.js";
import {
  A_WAITING_RESULT,
  aDoneResult,
  anAgentSession,
  anAskedDecision,
  answerAsked,
  anAgentStage,
  answerLastDecision,
  asksOnce,
  runsOf,
  walkStages,
} from "../pipelines-application.fixtures.js";
import { aTaskRecord } from "../ports/pipelines-ports.fixtures.js";
import {
  scriptStage,
  draft,
  agentDone,
  A_WAITING,
  pipelines,
  startWith,
  failing,
  statusesOf,
  statesOf,
  hireTheCto,
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

    it("frees a Task already stuck: a run failed before this, the branch moved along the base, and Run once more starts the Stage", async () => {
      await startWith();
      failing("The Stage didn't start.");
      const taskId = await walkStages(pipelines, [scriptStage("check")]);
      pipelines.git.move(taskId, { commit: moved, branch });
      pipelines.git.movesAlongBase.add(taskId);

      await answerLastDecision(pipelines, taskId, { kind: "option", option: 0 });

      expect(await statusesOf(taskId)).toEqual([
        ["check", "failed"],
        ["check", "done"],
      ]);
      expect((await runsOf(pipelines, taskId)).at(-1)?.headCommit).toBe(moved);
    });

    it("asks the user alone about any other move, even with a CTO hired", async () => {
      const { taskId, asked } = await movedWhileWaiting({ alongBase: false });
      hireTheCto();

      await answerAsked(pipelines, taskId, asked, { kind: "option", option: 0 });

      const [decision] = pipelines.decisions.on(taskId);
      expect(decision?.putTo).toBeUndefined();
      expect(decision?.draft.options[0]).toBe("Keep the branch as it is");
      expect(pipelines.stageThreads.requests).toHaveLength(1);
    });
  });

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
  });

  describe("the CTO first", () => {
    const measure = scriptStage("measure", { goBackTo: "draft", rounds: 1 });

    it("puts a round limit to the CTO, whose own words send the work back one more round", async () => {
      await startWith(agentDone, agentDone, agentDone);
      hireTheCto();
      const failures = failuresPutTo();
      failing("2 tests fail.", "Still 2.");
      const taskId = await walkStages(pipelines, [draft, measure]);

      await answerLastDecision(pipelines, taskId, {
        kind: "free-answer",
        text: "Mock the clock.",
        answeredBy: CTO,
      });

      expect(pipelines.decisions.on(taskId)).toMatchObject([{ putTo: CTO }]);
      expect(failures).toEqual([CTO]);
      const runs = await runsOf(pipelines, taskId);
      expect(runs[4]?.carriedFailure).toMatchObject({ round: 2, rounds: 2, guidedBy: CTO });
      const work = pipelines.stageThreads.requests.at(-1)?.work;
      expect(work).toContain("Guidance for this round from Bob (CTO):\n\nMock the clock.");
      expect(statesOf(taskId)).toEqual(["waiting-on-you", "in-progress", "done"]);
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
  });

  describe("a Hard switch", () => {
    it("has the Agent ask before an install, and go on without it once the user denies it", async () => {
      await startWith(anAgentSession(A_WAITING_RESULT), agentDone);
      const asked = anAskedDecision({
        question: "Allow this call? Install ffmpeg on the machine.",
        context:
          "For Devops: The Office has no Consultations yet, so you answer in their place.\n\nThe thumbnails need it.",
        options: ["Allow once", "Deny"],
        recommendation: { option: 0, reason: "Nothing else makes the thumbnails." },
      });
      asksOnce(pipelines, asked);
      const taskId = await walkStages(pipelines, [draft]);

      await answerAsked(pipelines, taskId, asked, { kind: "option", option: 1 });

      const [first, again] = pipelines.stageThreads.requests;
      expect(first?.record).toContain(
        "- Before you install anything that changes the machine outside the worktree, consult Devops first: ask approval of the call with consult, naming Devops, and make it only once the answer is Allow once.",
      );
      expect(again?.work).toContain(
        "## Your question, answered\n\nYou asked the user: Allow this call? Install ffmpeg on the machine.\n\nTheir answer: Deny",
      );
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
  });
});
