import { afterEach, describe, expect, it } from "vitest";
import type { SessionScript } from "../../engine/index.js";
import type { Stage } from "../domain/stage.js";
import type { StageOutcome } from "../domain/stage-run.js";
import { STAGE_RESULT_SCHEMA } from "../domain/stage-result.js";
import {
  aDoneResult,
  anAgentSession,
  anAgentStage,
  aTurn,
  runsOf,
  startPipelinesApplication,
  walkStages,
  type PipelinesApplication,
} from "../pipelines-application.fixtures.js";
import { aPerson } from "../ports/pipelines-ports.fixtures.js";
import { StageRunners } from "./stage-runners.js";

let pipelines: PipelinesApplication;

afterEach(async () => {
  await pipelines.app.close();
});

const implement = anAgentStage("implement", {
  name: "Implement",
  brief: "Implement the Plan until the Definition of Done is met.",
});

/** A session whose first result is `first`, corrected once to `corrected`. */
function corrected(first: unknown, second: unknown): SessionScript {
  return [
    { step: "start", brief: { id: "brief", text: "" } },
    aTurn(first),
    { step: "send", message: { id: "correction", text: "" }, priority: "later" },
    aTurn(second),
    { step: "end" },
  ];
}

async function outcomesOf(taskId: string): Promise<(StageOutcome | undefined)[]> {
  return (await runsOf(pipelines, taskId)).map(({ outcome }) => outcome);
}

describe("AgentStageRunner", () => {
  it("briefs a new session from the record, with the Stage's work and the commands it may run", async () => {
    pipelines = await startPipelinesApplication([
      anAgentSession(aDoneResult("Added the dialog.", "Left: the list's refresh.")),
    ]);

    const taskId = await walkStages(pipelines, [implement]);

    const [request] = pipelines.stageThreads.requests;
    expect(request).toMatchObject({
      taskId,
      roleKey: "developer",
      stageName: "Implement",
      declared: "fresh",
      previousThreadId: undefined,
      work: "## The Stage: Implement\n\nImplement the Plan until the Definition of Done is met.",
      folder: "/office/worktrees/admin-panel/task",
      environment: { PROJECT_VARIABLE: "set" },
      session: {
        profile: {
          edit: true,
          run: { kind: "project-commands", commandLines: ["npm run build", "npm test"] },
          web: false,
        },
        officeTools: ["read_task", "read_attachment"],
        outputSchema: STAGE_RESULT_SCHEMA,
      },
    });
    const record = request?.record ?? "";
    expect(record).toContain("## The Task\n\nRename a device, in the Project Admin panel.");
    expect(record).toContain("## The Plan\n\nAdd a rename dialog to the device page.");
    expect(record).toContain(
      "## The Definition of Done\n\n- The new name shows on the list\n- The rename persists",
    );
    expect(record).toContain("- mockup.png (image, image/png, 2048 bytes) · Attachment a-1");
    expect(record).toContain("- build: `npm run build`\n- test: `npm test`");
    expect(record).not.toContain("npm ci");
    const [run] = await runsOf(pipelines, taskId);
    expect(run?.outcome).toEqual({
      status: "done",
      summary: "Added the dialog.",
      handoverNote: "Left: the list's refresh.",
    });
    expect(pipelines.stageThreads.ended).toEqual([
      { threadId: run?.threadId, handoverNote: "Left: the list's refresh.", failure: undefined },
    ]);
  });

  it("hands the earlier results on and names the previous Agent Stage's Thread", async () => {
    pipelines = await startPipelinesApplication([
      anAgentSession(aDoneResult("Added the dialog.", "Left: the list's refresh.")),
      anAgentSession(aDoneResult("Reviewed.")),
    ]);
    pipelines.people.people.set("reviewer", aPerson("Rui"));
    const review = anAgentStage("review", {
      name: "Review & fix",
      role: "reviewer",
      session: "continue",
    });

    const taskId = await walkStages(pipelines, [implement, review]);

    const [first, second] = await runsOf(pipelines, taskId);
    const request = pipelines.stageThreads.requests[1];
    expect(request).toMatchObject({
      roleKey: "reviewer",
      declared: "continue",
      previousThreadId: first?.threadId,
    });
    expect(request?.record).toContain(
      "## Earlier Stages\n\n- Implement (Agent Stage): done. Added the dialog.\n  Handover note: Left: the list's refresh.",
    );
    expect(second?.outcome?.status).toBe("done");
  });

  it("names no previous Thread when a Script Stage ran in between", async () => {
    pipelines = await startPipelinesApplication([
      anAgentSession(aDoneResult()),
      anAgentSession(aDoneResult()),
    ]);
    pipelines.app.get(StageRunners).register("script", {
      run: () => Promise.resolve({ status: "done", summary: "Tests pass." }),
    });
    const tests: Stage = {
      kind: "script",
      key: "tests",
      name: "Tests",
      optional: false,
      command: "test",
    };

    await walkStages(pipelines, [
      implement,
      tests,
      anAgentStage("polish", { session: "continue" }),
    ]);

    expect(pipelines.stageThreads.requests[1]?.previousThreadId).toBeUndefined();
    expect(pipelines.stageThreads.requests[1]?.record).toContain(
      "- Tests (Script Stage): done. Tests pass.",
    );
  });

  it("corrects an invalid result once, in the same session", async () => {
    pipelines = await startPipelinesApplication([
      corrected({ status: "done", summary: "Added the dialog." }, aDoneResult("Added the dialog.")),
    ]);

    const taskId = await walkStages(pipelines, [implement]);

    expect(await outcomesOf(taskId)).toEqual([
      { status: "done", summary: "Added the dialog.", handoverNote: "Nothing is left." },
    ]);
    const [correction] = pipelines.stageThreads.sent;
    expect(correction?.text).toContain('status "done" requires "handoverNote".');
    expect(correction?.text).toContain("Don't redo the work");
    expect(correction?.why).toContain("The Office asked once to correct it");
  });

  it("fails the Stage when its corrected result is still invalid", async () => {
    pipelines = await startPipelinesApplication([
      corrected({ status: "finished" }, { status: "needs_decision", summary: "Which?" }),
    ]);

    const taskId = await walkStages(pipelines, [implement]);

    const error =
      'The Stage\'s result still didn\'t match its schema after one correction: status "needs_decision" requires "decision".';
    expect(await outcomesOf(taskId)).toEqual([{ status: "failed", error }]);
    expect(pipelines.stageThreads.sent).toHaveLength(1);
    expect(pipelines.stageThreads.ended[0]).toMatchObject({ failure: error });
  });

  it("ends needing a Decision with what the Agent asks", async () => {
    const decision = {
      question: "Which page shows the rename?",
      context: "Both list devices.",
      options: ["The device page", "The list"],
      recommendation: { option: 0, reason: "It has the room." },
    };
    pipelines = await startPipelinesApplication([
      anAgentSession({ status: "needs_decision", summary: "Asked.", decision }),
    ]);

    const taskId = await walkStages(pipelines, [implement]);

    expect(await outcomesOf(taskId)).toEqual([{ status: "needs-decision", ...decision }]);
  });

  it("fails the Stage, with no session, when nobody fills its Role", async () => {
    pipelines = await startPipelinesApplication();
    pipelines.people.people.delete("developer");

    const taskId = await walkStages(pipelines, [implement]);

    expect(await outcomesOf(taskId)).toEqual([
      {
        status: "failed",
        error: 'Nobody fills the Role "developer" this Stage needs: hire them on People.',
      },
    ]);
    expect(pipelines.stageThreads.requests).toEqual([]);
  });
});
