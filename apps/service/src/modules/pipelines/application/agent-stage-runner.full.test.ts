import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { currentOperatingSystem } from "../../../platform/os/current-operating-system.js";
import { EngineModels } from "../../engine/index.js";
import type { Stage } from "../domain/stage.js";
import type { StageOutcome } from "../domain/stage-run.js";
import { startStageRun } from "../domain/stage-run-changes.js";
import {
  A_WAITING_RESULT,
  aDoneResult,
  anAgentSession,
  anAskedDecision,
  anAgentStage,
  runsOf,
  startPipelinesApplication,
  walkStages,
  type PipelinesApplication,
} from "../pipelines-application.fixtures.js";
import {
  aCommandRun,
  recordedRun,
  aPerson,
  PLANNED_COMMIT,
} from "../ports/pipelines-ports.fixtures.js";
import { isRunning } from "../../../platform/os/process-trees.fixtures.js";
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
  it("keeps the session's engine and model", async () => {
    pipelines = await startPipelinesApplication([anAgentSession(aDoneResult())]);

    const taskId = await walkStages(pipelines, [anAgentStage("implement", { name: "Implement" })]);

    const [run] = await runsOf(pipelines, taskId);
    expect(run).toMatchObject({
      engineId: "claude-code",
      engineName: "Claude Code",
      model: "scripted",
    });
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

  it("fails the Stage when its corrected result is still invalid", async () => {
    pipelines = await startPipelinesApplication([
      corrected({ status: "finished" }, { status: "needs_decision", summary: "Which?" }),
    ]);

    const taskId = await walkStages(pipelines, [implement]);

    const error =
      "The Stage's result still didn't match its schema after one correction: status \"needs_decision\" means you opened a Decision with open_decision or consult, and you opened none. Open it with one of them first, then end your turn with needs_decision again.";
    expect(await outcomesOf(taskId)).toEqual([{ status: "failed", error }]);
    expect(pipelines.stageThreads.sent).toHaveLength(1);
    expect(pipelines.stageThreads.ended[0]).toMatchObject({
      closing: { kind: "failure", reason: error },
    });
  });

  it("attaches exactly the screenshots the result lists, in the person's name", async () => {
    pipelines = await startPipelinesApplication([
      anAgentSession({ ...aDoneResult("Added the dialog."), screenshots: ["dialog/open.png"] }),
    ]);

    const taskId = await walkStages(pipelines, [implement]);

    expect(pipelines.screenshots.attached).toEqual([
      { taskId, roleKey: "developer", paths: ["dialog/open.png"] },
    ]);
    expect(await outcomesOf(taskId)).toEqual([expect.objectContaining({ status: "done" })]);
    expect(pipelines.stageThreads.sent).toHaveLength(0);
  });

  it("asks once to correct a list of screenshots that can't be attached", async () => {
    pipelines = await startPipelinesApplication([
      corrected(
        { ...aDoneResult("Added the dialog."), screenshots: ["dialog/open.png", "huge.png"] },
        { ...aDoneResult("Added the dialog."), screenshots: ["dialog/open.png"] },
      ),
    ]);
    pipelines.screenshots.refusals.push(["huge.png is over 2 MB."]);

    const taskId = await walkStages(pipelines, [implement]);

    const [correction] = pipelines.stageThreads.sent;
    expect(correction?.text).toContain(
      "None of the screenshots you listed was attached, as The Office attaches all or none:\n- huge.png is over 2 MB.",
    );
    expect(pipelines.screenshots.attached).toEqual([
      { taskId, roleKey: "developer", paths: ["dialog/open.png"] },
    ]);
    expect(await outcomesOf(taskId)).toEqual([expect.objectContaining({ status: "done" })]);
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
    expect(run?.commandRuns).toEqual([recordedRun(install, "install")]);
    expect(run?.outcome?.status).toBe("done");
  });

  it("fails the Stage in words, with no session ahead, while no engine is listed", async () => {
    pipelines = await startPipelinesApplication();
    // The only engine removed; spied, as every test file shares the engine settings.
    vi.spyOn(pipelines.app.get(EngineModels), "engines").mockResolvedValue([]);
    if (implement.kind !== "agent") throw new Error("Implement is an Agent Stage.");
    const { run } = startStageRun(
      {
        id: randomUUID(),
        taskId: randomUUID(),
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
      error: "Settings › Engines lists no engine, so no session starts; add one there first.",
    });
    expect(pipelines.stageThreads.requests).toEqual([]);
    // The all clear shows nothing resuming.
    await expect(
      pipelines.app
        .get(AgentStageRunner)
        .sessionAhead(run.taskId, { stage: implement, stages: [implement], earlierRuns: [] }),
    ).resolves.toBeUndefined();
  });
});

describe("AgentStageRunner after the session", () => {
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

  it("starts the first Stage on a branch that conflicts with the base, telling its Agent of the tool", async () => {
    pipelines = await startPipelinesApplication([anAgentSession(aDoneResult())]);
    const taskId = randomUUID();
    pipelines.git.branchUpdates.set(taskId, { kind: "conflicted", conflictedFiles: ["a.ts"] });

    await walkStages(pipelines, [implement], taskId);

    expect(pipelines.stageThreads.requests[0]?.work).toContain("update_branch");
    expect(pipelines.stageThreads.requests[0]?.work).toContain("a.ts");
  });

  it("updates the branch only for the Task's first Stage", async () => {
    pipelines = await startPipelinesApplication([
      anAgentSession(aDoneResult()),
      anAgentSession(aDoneResult()),
    ]);
    const taskId = randomUUID();
    pipelines.git.unchanged.add(taskId);
    pipelines.stageThreads.whileWorking = () => {
      pipelines.git.branchUpdates.set(taskId, { kind: "updated", commit: "c".repeat(40) });
    };

    await walkStages(pipelines, [implement, anAgentStage("polish")], taskId);

    expect((await runsOf(pipelines, taskId)).map(({ headCommit }) => headCommit)).toEqual([
      PLANNED_COMMIT,
      PLANNED_COMMIT,
    ]);
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
