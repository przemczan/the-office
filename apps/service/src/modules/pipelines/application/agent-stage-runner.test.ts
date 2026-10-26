import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { currentOperatingSystem } from "../../../platform/os/current-operating-system.js";
import type { SessionScript } from "../../engine/index.js";
import type { Stage } from "../domain/stage.js";
import type { StageOutcome } from "../domain/stage-run.js";
import { STAGE_RESULT_SCHEMA } from "../domain/stage-result.js";
import {
  A_WAITING_RESULT,
  aDoneResult,
  anAgentSession,
  anAskedDecision,
  anAgentStage,
  aTurn,
  runsOf,
  startPipelinesApplication,
  walkStages,
  type PipelinesApplication,
} from "../pipelines-application.fixtures.js";
import {
  aCommandRun,
  aPerson,
  aTaskRecord,
  PLANNED_COMMIT,
} from "../ports/pipelines-ports.fixtures.js";
import { isRunning } from "../../../platform/os/process-trees.fixtures.js";

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
        officeTools: [
          "read_task",
          "read_attachment",
          "open_decision",
          "consult",
          "attach_file",
          "attach_link",
        ],
        outputSchema: STAGE_RESULT_SCHEMA,
      },
    });
    const record = request?.record ?? "";
    expect(record).toContain("## The Task\n\nRename a device, in the Project Admin panel.");
    expect(record).toContain("## The Plan\n\nAdd a rename dialog to the device page.");
    expect(record).toContain(
      "## The Definition of Done\n\n1. The new name shows on the list\n2. The rename persists",
    );
    expect(record).toContain("- mockup.png (image, image/png, 2048 bytes) · Attachment a-1");
    expect(record).toContain("- build: `npm run build`\n- test: `npm test`");
    expect(record).not.toContain("npm ci");
    const [run] = await runsOf(pipelines, taskId);
    expect(run?.outcome).toEqual({
      status: "done",
      summary: "Added the dialog.",
      handoverNote: "Left: the list's refresh.",
      definitionOfDoneMet: [1, 2],
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
      "- Tests (Script Stage): done. `npm run test` passed.",
    );
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

  it("fails the Stage when its corrected result is still invalid", async () => {
    pipelines = await startPipelinesApplication([
      corrected({ status: "finished" }, { status: "needs_decision", summary: "Which?" }),
    ]);

    const taskId = await walkStages(pipelines, [implement]);

    const error =
      "The Stage's result still didn't match its schema after one correction: status \"needs_decision\" means you opened a Decision with open_decision or consult, and you opened none. Open it with one of them first, then end your turn with needs_decision again.";
    expect(await outcomesOf(taskId)).toEqual([{ status: "failed", error }]);
    expect(pipelines.stageThreads.sent).toHaveLength(1);
    expect(pipelines.stageThreads.ended[0]).toMatchObject({ failure: error });
  });

  it("ends needing the Decision the Agent opened with an Office tool, even after a correction", async () => {
    const asked = anAskedDecision();
    pipelines = await startPipelinesApplication([
      corrected({ status: "needs_decision", summary: "Which?" }, A_WAITING_RESULT),
    ]);
    let turns = 0;
    // The Agent opens it only once the correction asks it to.
    pipelines.stageThreads.asksInTurn = () => (++turns === 2 ? asked : undefined);

    const taskId = await walkStages(pipelines, [implement]);

    const { id: _id, ...draft } = asked;
    expect(await outcomesOf(taskId)).toEqual([
      { status: "needs-decision", ...draft, handoverNote: "Waiting on the user." },
    ]);
    expect(pipelines.stageThreads.sent[0]?.text).toContain(
      'status "needs_decision" means you opened a Decision with open_decision or consult, and you opened none.',
    );
  });

  it("installs the dependencies before the session, and tells the Agent when the install failed", async () => {
    pipelines = await startPipelinesApplication([anAgentSession(aDoneResult())]);
    const install = aCommandRun("npm ci", "failed", "npm ERR! Missing: left-pad");
    pipelines.commands.installations.push({ kind: "ran", run: install });
    const calls: string[] = [];
    pipelines.commands.observe = (call) => void calls.push(call);
    pipelines.stageThreads.whileWorking = () => void calls.push("session");

    const taskId = await walkStages(pipelines, [implement]);

    expect(calls).toEqual(["install", "session"]);
    expect(pipelines.stageThreads.requests[0]?.work).toContain(
      "## The install before this Stage\n\nInstalling the Project's dependencies failed: `npm ci` failed with exit code 1.\n\nWhat it printed:\n\n```\nnpm ERR! Missing: left-pad\n```",
    );
    const [run] = await runsOf(pipelines, taskId);
    expect(run?.commandRuns).toEqual([{ ...install, purpose: "install" }]);
    expect(run?.outcome?.status).toBe("done");
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
        "Implement: Added the rename dialog.\n\nAdded the rename dialog.\n\nIt saves on Enter.\n\nHandover note:\nLeft: the list's refresh.",
      commit: expect.any(String),
    });
    const [run] = await runsOf(pipelines, taskId);
    expect(run?.headCommit).toBe(commit?.commit);
    expect(run?.outcome?.status).toBe("done");
  });

  it("ends what the session left running, such as a dev server, before git reads the worktree", async () => {
    const folder = await mkdtemp(join(tmpdir(), "office-stage-leftovers-"));
    const pidFile = join(folder, "dev-server.pid");
    // The stand-in engine starts a dev server that outlives it, as a background Bash call does:
    // detached on Windows, where Node ends its non-detached children with it; in its group on Linux.
    const standInEngine = `
      const devServer = require("node:child_process").spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore", detached: process.platform === "win32" });
      devServer.unref();
      require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(devServer.pid));
      process.stdin.resume();
      process.stdin.on("end", () => process.exit(0));`;
    try {
      pipelines = await startPipelinesApplication([anAgentSession(aDoneResult())], {
        command: process.execPath,
        args: ["-e", standInEngine],
        processTrees: currentOperatingSystem().processTrees,
      });
      let devServer = 0;
      pipelines.stageThreads.whileWorking = async () => {
        devServer = await vi.waitFor(async () => Number(await readFile(pidFile, "utf8")), {
          timeout: 10_000,
        });
        expect(isRunning(devServer)).toBe(true);
      };
      let runningAtCommit: boolean | undefined;
      pipelines.git.observe = (call) => {
        if (call === "commit") runningAtCommit = isRunning(devServer);
      };

      const taskId = await walkStages(pipelines, [implement]);

      expect(devServer).toBeGreaterThan(0);
      expect(runningAtCommit).toBe(false);
      expect(isRunning(devServer)).toBe(false);
      expect(await outcomesOf(taskId)).toMatchObject([{ status: "done" }]);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  }, 30_000);

  it("briefs the next Stage with what the Task's commits changed so far", async () => {
    pipelines = await startPipelinesApplication([
      anAgentSession(aDoneResult()),
      anAgentSession(aDoneResult()),
    ]);
    const taskId = randomUUID();
    pipelines.stageThreads.whileWorking = () => {
      pipelines.git.changes.set(
        taskId,
        " src/rename.ts | 12 +++\n 1 file changed, 12 insertions(+)",
      );
    };

    await walkStages(pipelines, [implement, anAgentStage("polish")], taskId);

    const [first, second] = pipelines.stageThreads.requests;
    expect(first?.record).not.toContain("## What changed so far");
    expect(second?.record).toContain(
      "## What changed so far\n\n src/rename.ts | 12 +++\n 1 file changed, 12 insertions(+)",
    );
  });

  it("expects HEAD where the last Stage left it when the next one changed nothing", async () => {
    pipelines = await startPipelinesApplication([
      anAgentSession(aDoneResult()),
      anAgentSession(aDoneResult()),
    ]);
    const taskId = randomUUID();
    pipelines.git.unchanged.add(taskId);

    await walkStages(pipelines, [implement, anAgentStage("polish")], taskId);

    expect(pipelines.git.commits).toEqual([]);
    expect((await runsOf(pipelines, taskId)).map(({ headCommit }) => headCommit)).toEqual([
      PLANNED_COMMIT,
      PLANNED_COMMIT,
    ]);
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
    expect(pipelines.stageThreads.ended[1]?.failure).toBe(error);
    expect(again?.stageKey).toBe("implement");
    expect(again?.outcome).toEqual({
      status: "failed",
      error: `The Task's worktree isn't where The Office left it: HEAD moved from ${implemented?.commit.slice(0, 8)} to ffffffff. The Stage didn't start; put the branch back to go on.`,
    });
    expect(pipelines.stageThreads.requests).toHaveLength(2);
  });

  it("fails a Stage that switched the worktree's branch", async () => {
    pipelines = await startPipelinesApplication([anAgentSession(aDoneResult())]);
    const taskId = randomUUID();
    pipelines.stageThreads.whileWorking = () => {
      pipelines.git.move(taskId, { commit: PLANNED_COMMIT, branch: undefined });
    };

    await walkStages(pipelines, [implement], taskId);

    expect(pipelines.git.commits).toEqual([]);
    expect(await outcomesOf(taskId)).toEqual([
      {
        status: "failed",
        error:
          "The Stage changed git itself: the worktree is on a detached HEAD, not the Task's branch office/task. Only The Office commits a Stage's work, so it stopped here without committing.",
        handoverNote: "Nothing is left.",
      },
    ]);
  });
});
