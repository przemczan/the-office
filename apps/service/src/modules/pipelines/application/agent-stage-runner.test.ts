import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { READING_OFFICE_TOOLS } from "../../conversations/index.js";
import type { StageOutcome } from "../domain/stage-run.js";
import { STAGE_RESULT_SCHEMA } from "../domain/stage-result.js";
import { startStageRun } from "../domain/stage-run-changes.js";
import {
  aDoneResult,
  anAgentSession,
  anAgentStage,
  runsOf,
  startPipelinesApplication,
  walkStages,
  type PipelinesApplication,
} from "../pipelines-application.fixtures.js";
import { aTaskRecord } from "../ports/pipelines-ports.fixtures.js";
import { AgentStageRunner } from "./agent-stage-runner.js";
import { StageRunInterruption } from "./stage-run-interruption.js";
import { implement, corrected } from "../agent-stage-runner.fixtures.js";

let pipelines: PipelinesApplication;

afterEach(async () => {
  await pipelines.app.close();
});

async function outcomesOf(taskId: string): Promise<(StageOutcome | undefined)[]> {
  return (await runsOf(pipelines, taskId)).map(({ outcome }) => outcome);
}

describe("AgentStageRunner", () => {
  it("briefs a new session from the record, with the Stage's work, the commands it may run and every reading tool", async () => {
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
        officeTools: [
          ...READING_OFFICE_TOOLS,
          "open_decision",
          "consult",
          "attach_file",
          "attach_link",
          "update_branch",
          "run_project_command",
        ],
        outputSchema: STAGE_RESULT_SCHEMA,
      },
    });
    const record = request?.record ?? "";
    expect(record).toContain("## The Task\n\nRename a device, in the Project Admin panel.");
    expect(record).toContain(
      "## What the user wants, in their own words\n\nLet me name each device as I call it.",
    );
    expect(record).toContain("## The Plan\n\nAdd a rename dialog to the device page.");
    expect(record).toContain(
      "## The Definition of Done\n\n1. The new name shows on the list\n2. The rename persists",
    );
    expect(record).toContain("- mockup.png (image, image/png, 2048 bytes) · Attachment a-1");
    expect(record).toContain("- build (Build): `npm run build`\n- test (Test): `npm test`");
    expect(record).not.toContain("npm ci");
    const [run] = await runsOf(pipelines, taskId);
    expect(run?.outcome).toEqual({
      status: "done",
      summary: "Added the dialog.",
      handoverNote: "Left: the list's refresh.",
      definitionOfDoneMet: [1, 2],
    });
    expect(pipelines.stageThreads.ended).toEqual([
      { threadId: run?.threadId, handoverNote: "Left: the list's refresh.", closing: undefined },
    ]);
  });

  it("narrows the Role card's profile by the Stage's permissions, never widening it, and briefs the narrowed commands", async () => {
    pipelines = await startPipelinesApplication([anAgentSession(aDoneResult("Reviewed."))]);

    await walkStages(pipelines, [
      anAgentStage("implement", {
        name: "Implement",
        permissions: {
          edit: false,
          run: "read-only-git",
          mcpTools: {
            "github/merge": { kind: "never" },
            "github/list_issues": { kind: "allowed" },
          },
        },
      }),
    ]);

    const [request] = pipelines.stageThreads.requests;
    expect(request?.session.profile).toEqual({
      edit: false,
      run: { kind: "read-only-git" },
      web: false,
      mcpTools: {
        "github/merge": { kind: "never" },
        "github/list_issues": { kind: "consult", role: "devops" },
      },
    });
    expect(request?.record).toContain("You may run read-only git");
    expect(request?.record).not.toContain("npm test");
  });

  it("corrects an invalid result once, in the same session", async () => {
    pipelines = await startPipelinesApplication([
      corrected({ status: "done", summary: "Added the dialog." }, aDoneResult("Added the dialog.")),
    ]);

    const taskId = await walkStages(pipelines, [implement]);

    expect(await outcomesOf(taskId)).toEqual([
      {
        status: "done",
        summary: "Added the dialog.",
        handoverNote: "Nothing is left.",
        definitionOfDoneMet: [1, 2],
      },
    ]);
    const [correction] = pipelines.stageThreads.sent;
    expect(correction?.text).toContain('status "done" requires "handoverNote".');
    expect(correction?.text).toContain("Don't redo the work");
    expect(correction?.why).toContain("The Office asked once to correct it");
  });

  // The walk holds the Task before such a Stage; the runner still refuses one let go meanwhile.
  it("fails the Stage, with no session, when nobody fills its Role", async () => {
    pipelines = await startPipelinesApplication();
    pipelines.people.people.delete("developer");
    if (implement.kind !== "agent") throw new Error("Implement is an Agent Stage.");
    const taskId = randomUUID();
    const { run } = startStageRun(
      {
        id: randomUUID(),
        taskId,
        stageKey: implement.key,
        carriedFailure: undefined,
        sentBack: undefined,
      },
      0,
      new Date(),
    );

    const outcome = await pipelines.app.get(AgentStageRunner).run({
      stage: implement,
      run,
      stages: [implement],
      earlierRuns: [],
      interruption: new StageRunInterruption(),
    });

    expect(outcome).toEqual({
      status: "failed",
      error: 'Nobody fills the Role "developer" this Stage needs: hire them on People.',
    });
    expect(pipelines.stageThreads.requests).toEqual([]);
  });
});

describe("AgentStageRunner after the session", () => {
  it("ends the session, then commits the Stage's work with a message from its result and Handover note", async () => {
    pipelines = await startPipelinesApplication([
      anAgentSession(
        aDoneResult("Added the rename dialog.\n\nIt saves on Enter.", "Left: the list's refresh."),
      ),
    ]);
    const sessionEndedAt: Record<string, boolean> = {};
    pipelines.git.observe = (call) => {
      const ended = pipelines.engine.sessions[0]?.received.some(({ step }) => step === "end");
      sessionEndedAt[call] = ended ?? false;
    };

    const taskId = await walkStages(pipelines, [implement]);

    expect(sessionEndedAt).toEqual({ head: true, commit: true, changesSoFar: false });
    expect(pipelines.stageThreads.sessionsEnded).toHaveLength(1);
    const [commit] = pipelines.git.commits;
    expect(commit).toEqual({
      taskId,
      message:
        "Implement: Rename a device\n\nAdded the rename dialog.\n\nIt saves on Enter.\n\nHandover note:\nLeft: the list's refresh.",
      commit: expect.any(String),
    });
    const [run] = await runsOf(pipelines, taskId);
    expect(run?.headCommit).toBe(commit?.commit);
    expect(run?.outcome?.status).toBe("done");
  });

  it("starts the Task's first Stage on the fresh base, telling its Agent", async () => {
    pipelines = await startPipelinesApplication([anAgentSession(aDoneResult())]);
    const taskId = randomUUID();
    const commit = "b".repeat(40);
    pipelines.git.branchUpdates.set(taskId, { kind: "updated", commit });
    pipelines.git.unchanged.add(taskId);

    await walkStages(pipelines, [implement], taskId);

    expect((await runsOf(pipelines, taskId))[0]?.headCommit).toBe(commit);
    expect(pipelines.stageThreads.requests[0]?.work).toContain("up to date with");
  });

  it("fails a Stage that moved HEAD with the reason, commits nothing, and starts no session on it after", async () => {
    pipelines = await startPipelinesApplication([
      anAgentSession(aDoneResult()),
      anAgentSession(aDoneResult("Committed it myself.", "Nothing is left.")),
    ]);
    const taskId = randomUUID();
    const branch = aTaskRecord().worktree.branch;
    pipelines.stageThreads.whileWorking = ({ stageName }) => {
      if (stageName === "Review") pipelines.git.move(taskId, { commit: "f".repeat(40), branch });
    };
    const review = anAgentStage("review", {
      name: "Review",
      onFailure: { goBackTo: "implement", rounds: 1 },
    });

    await walkStages(pipelines, [implement, review], taskId);

    const [implemented] = pipelines.git.commits;
    expect(pipelines.git.commits).toHaveLength(1);
    const [, moved, again] = await runsOf(pipelines, taskId);
    const error = `The Stage changed git itself: HEAD moved from ${implemented?.commit.slice(0, 8)} to ffffffff. Only The Office commits a Stage's work, so it stopped here without committing.`;
    expect(moved?.outcome).toEqual({ status: "failed", error, handoverNote: "Nothing is left." });
    expect(moved?.headCommit).toBe(implemented?.commit);
    expect(pipelines.stageThreads.ended[1]?.closing).toEqual({ kind: "failure", reason: error });
    expect(again?.stageKey).toBe("implement");
    expect(again?.outcome).toEqual({
      status: "failed",
      error: `The Task's worktree isn't where The Office left it: HEAD moved from ${implemented?.commit.slice(0, 8)} to ffffffff. The Stage didn't start.`,
      branchMoved: true,
    });
    expect(pipelines.stageThreads.requests).toHaveLength(2);
  });
});
