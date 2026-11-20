import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  READ_STAGE_HISTORY_TOOL,
  READ_THREADS_TOOL,
  READING_OFFICE_TOOLS,
} from "../../conversations/index.js";
import type { AgentStage } from "../domain/stage.js";
import type { StageOutcome } from "../domain/stage-run.js";
import { STAGE_RESULT_SCHEMA } from "../domain/stage-result.js";
import { startStageRun } from "../domain/stage-run-changes.js";
import {
  aDoneResult,
  anAgentSession,
  anAgentStage,
  runsOf,
  startPipelinesApplication,
  startPipelinesApplicationWith,
  walkStages,
  type PipelinesApplication,
} from "../pipelines-application.fixtures.js";
import { aTaskRecord } from "../ports/pipelines-ports.fixtures.js";
import {
  PromptTemplateRepository,
  PromptTemplateRepositoryForTests,
} from "../../prompt-templates/index.fixtures.js";
import { PromptTemplates } from "../../prompt-templates/index.js";
import { SIGNED_IN_FOR_TESTS } from "../../../platform/http/signed-in-requests.fixtures.js";
import { userOf } from "../../../platform/http/signed-in-requests.js";
import { STAGE_BRIEF, STAGE_MESSAGE } from "../domain/agent-stage-brief-templates.js";
import { AGENT_STAGE_OFFICE_TOOLS } from "./agent-stage-runner.js";
import { AgentStageRunner } from "./agent-stage-runner.js";
import { StageRunInterruption } from "./stage-run-interruption.js";
import { implement, corrected } from "../agent-stage-runner.fixtures.js";
import { aScriptStage, failing, passing } from "./script-stage-runner.fixtures.js";

const ANN = userOf(SIGNED_IN_FOR_TESTS);

let pipelines: PipelinesApplication;

afterEach(async () => {
  await pipelines.app.close();
});

async function outcomesOf(taskId: string): Promise<(StageOutcome | undefined)[]> {
  return (await runsOf(pipelines, taskId)).map(({ outcome }) => outcome);
}

/** The session passes `limit` as its first turn runs, and none in the fresh one after. */
function passesOnFirstTurn(limit: "soft" | "hard"): void {
  let turns = 0;
  pipelines.stageThreads.whileTurnRuns = (threadId) => {
    turns += 1;
    if (turns === 1) pipelines.stageThreads.limitPassed.set(threadId, limit);
  };
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
      work: "## The Stage: Implement\n\nImplement the Plan until the Definition of Done is met.\n\n## Later Stages\n\nNo Stage comes after this one in the Task's Pipeline.",
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
          READ_STAGE_HISTORY_TOOL,
          "open_decision",
          "consult",
          "attach_file",
          "attach_link",
          "write_commit_message",
          "update_branch",
          "run_project_command",
          "propose_bug_task",
        ],
        outputSchema: STAGE_RESULT_SCHEMA,
      },
    });
    expect(request?.session.instructions).toContain(
      "Your own shell runs on this computer, outside the run environment, so run the Project's checks with run_project_command",
    );
    expect(request?.session.instructions).toContain(
      "The Stage ends when your turn ends, with your result, so finish within the turn whatever work you need: your sub-agents run in the foreground and answer within it",
    );
    expect(request?.session.instructions).toContain(
      "Stop the background commands you no longer need before you end it.",
    );
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
    expect(request?.session.officeTools).not.toContain(READ_THREADS_TOOL);
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

  it("lists the Stages after this one in its message, also when a loop sends the work back to it", async () => {
    pipelines = await startPipelinesApplication([
      anAgentSession(aDoneResult()),
      anAgentSession(aDoneResult()),
      anAgentSession(aDoneResult()),
    ]);
    pipelines.people.titles.set("developer", "Developer");
    pipelines.commands.commandRuns.push([failing, failing], [passing]);

    await walkStages(pipelines, [
      implement,
      aScriptStage("test", { onFailure: { goBackTo: "implement", rounds: 1 } }),
      anAgentStage("review", { name: "Review" }),
    ]);

    const [first, again, review] = pipelines.stageThreads.requests.map(({ work }) => work);
    const later =
      "## Later Stages\n\nThese Stages come after this one in the Task's Pipeline, in order:\n\n- Tests (Script Stage): runs `npm test`. If it fails, the work comes back here.\n- Review (Agent Stage, Developer): Do review.";
    expect(first).toContain(`met.\n\n${later}`);
    expect(again).toContain("## Why this Stage runs again");
    expect(again).toContain(later);
    expect(review).toContain(
      "## Later Stages\n\nNo Stage comes after this one in the Task's Pipeline.",
    );
  });

  it("keeps only the Stage's Project commands, in the Brief and the allowed lines, now and ahead", async () => {
    pipelines = await startPipelinesApplication([anAgentSession(aDoneResult())]);
    const narrowed: AgentStage = {
      kind: "agent",
      key: "implement",
      name: "Implement",
      optional: false,
      role: "developer",
      brief: "Implement the Plan until the Definition of Done is met.",
      session: "fresh",
      budget: 100_000,
      permissions: { commands: ["test", "e2e"] },
    };

    const taskId = await walkStages(pipelines, [narrowed]);
    await pipelines.app
      .get(AgentStageRunner)
      .sessionAhead(taskId, { stage: narrowed, stages: [narrowed], earlierRuns: [] });

    const [request] = pipelines.stageThreads.requests;
    expect(request?.session.profile.run).toEqual({
      kind: "project-commands",
      commandLines: ["npm test"],
    });
    const briefed = "- test (Test): `npm test`";
    expect(request?.record).toContain(
      `read-only git (git status, git diff, git log, git show):\n\n${briefed}`,
    );
    expect(request?.record).not.toContain("npm run build");
    const [ahead] = pipelines.stageThreads.askedAhead;
    expect(ahead?.record).toContain(briefed);
    expect(ahead?.record).not.toContain("npm run build");
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

  describe("past a context limit (spec §2.5)", () => {
    const HANDING_OVER = {
      status: "handing_over",
      summary: "Halfway through the dialog.",
      handoverNote: "The dialog is in; the list's refresh is left.",
    };

    it("goes on in a fresh session of the same run after a handover, briefed with the Handover note, and commits once", async () => {
      pipelines = await startPipelinesApplication([
        corrected(HANDING_OVER, aDoneResult("Added the dialog.")),
      ]);
      passesOnFirstTurn("soft");

      const taskId = await walkStages(pipelines, [implement]);

      const [run, ...more] = await runsOf(pipelines, taskId);
      expect(more).toEqual([]);
      expect(run?.outcome).toMatchObject({ status: "done", summary: "Added the dialog." });
      expect(run?.tokens).toEqual({ input: 20, output: 20, cacheRead: 0, cacheCreation: 0 });
      expect(pipelines.git.commits).toHaveLength(1);
      expect(pipelines.stageThreads.sent).toEqual([]);
      const [restart, ...again] = pipelines.stageThreads.restarted;
      expect(again).toEqual([]);
      expect(restart).toMatchObject({
        threadId: run?.threadId,
        handoverNote: "The dialog is in; the list's refresh is left.",
      });
      expect(restart?.brief).toContain("## The Task\n\nRename a device");
      expect(restart?.brief).toContain(
        "## Handover note from this Stage's earlier session\n\nThis Stage began in an earlier session",
      );
      expect(restart?.brief).toContain(
        "Its Handover note:\n\nThe dialog is in; the list's refresh is left.",
      );
      expect(restart?.brief).toContain("left.\n\n## The Stage: Implement");
    });

    it("goes on with no Handover note after a hard-limit turn that gave no result", async () => {
      pipelines = await startPipelinesApplication([
        corrected(undefined, aDoneResult("Added the dialog.")),
      ]);
      passesOnFirstTurn("hard");

      const taskId = await walkStages(pipelines, [implement]);

      expect(await outcomesOf(taskId)).toEqual([
        expect.objectContaining({ status: "done", summary: "Added the dialog." }),
      ]);
      expect(pipelines.stageThreads.sent).toEqual([]);
      const [restart] = pipelines.stageThreads.restarted;
      expect(restart?.handoverNote).toBeUndefined();
      expect(restart?.brief).toContain("It wrote no Handover note: check the worktree's diff");
    });

    it("corrects a handover the session wasn't asked for, never restarting", async () => {
      pipelines = await startPipelinesApplication([
        corrected(HANDING_OVER, aDoneResult("Added the dialog.")),
      ]);

      const taskId = await walkStages(pipelines, [implement]);

      expect(await outcomesOf(taskId)).toEqual([
        expect.objectContaining({ status: "done", summary: "Added the dialog." }),
      ]);
      expect(pipelines.stageThreads.restarted).toEqual([]);
      const [correction] = pipelines.stageThreads.sent;
      expect(correction?.text).toContain('status "handing_over" is only for when The Office asks');
    });

    it("hands the Stage's own limits, none for No limit, or else the Office defaults, to its Thread", async () => {
      pipelines = await startPipelinesApplication([
        anAgentSession(aDoneResult()),
        anAgentSession(aDoneResult()),
        anAgentSession(aDoneResult()),
      ]);
      pipelines.contextLimitDefaults.limits = { soft: 120_000, hard: 200_000 };

      await walkStages(pipelines, [
        anAgentStage("own", {
          contextLimits: { kind: "set", limits: { soft: 60_000, hard: 90_000 } },
        }),
        anAgentStage("none", { contextLimits: { kind: "none" } }),
        anAgentStage("defaults"),
      ]);

      expect(pipelines.stageThreads.requests.map(({ contextLimits }) => contextLimits)).toEqual([
        { soft: 60_000, hard: 90_000 },
        undefined,
        { soft: 120_000, hard: 200_000 },
      ]);
    });
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

  it("briefs the Stage and words its message as the user saved their Prompt templates", async () => {
    // Texts of the test's own: every test file shares the database, where the runner reads them.
    pipelines = await startPipelinesApplicationWith(
      [{ provide: PromptTemplateRepository, useValue: new PromptTemplateRepositoryForTests() }],
      [anAgentSession(aDoneResult("Added the dialog.", "Left: the list's refresh."))],
    );
    const promptTemplates = pipelines.app.get(PromptTemplates);
    await promptTemplates.save(
      STAGE_BRIEF.key,
      "Task: {{title}} ({{projectName}}), on {{worktreeBranch}}.{{#hasDefinitionOfDone}} Done when:{{#definitionOfDone}} {{number}}) {{statement}}{{/definitionOfDone}}{{/hasDefinitionOfDone}}",
      ANN,
    );
    await promptTemplates.save(STAGE_MESSAGE.key, "Now: {{stageName}}. {{stageBrief}}", ANN);

    await walkStages(pipelines, [implement]);

    const [request] = pipelines.stageThreads.requests;
    expect(request?.record).toBe(
      "Task: Rename a device (Admin panel), on office/task. Done when: 1) The new name shows on the list 2) The rename persists",
    );
    expect(request?.work).toBe(
      "Now: Implement. Implement the Plan until the Definition of Done is met.",
    );
  });
});

describe("An Agent Stage's Office tools", () => {
  it("propose a Bug Task, and never create a Task", () => {
    expect(AGENT_STAGE_OFFICE_TOOLS).toContain("propose_bug_task");
    expect(AGENT_STAGE_OFFICE_TOOLS).not.toContain("create_task");
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

    const taskId = randomUUID();
    const paths = ["src/rename-dialog.tsx", "src/rename-dialog.test.tsx"];
    pipelines.git.uncommitted.set(taskId, paths);

    await walkStages(pipelines, [implement], taskId);

    expect(sessionEndedAt).toEqual({ head: true, commit: true, changesSoFar: false });
    expect(pipelines.stageThreads.sessionsEnded).toHaveLength(1);
    const [commit] = pipelines.git.commits;
    expect(commit).toEqual({
      taskId,
      message:
        "Implement: Rename a device\n\nAdded the rename dialog.\n\nIt saves on Enter.\n\nHandover note:\nLeft: the list's refresh.",
      commit: expect.any(String),
      paths,
    });
    const [run] = await runsOf(pipelines, taskId);
    expect(run?.headCommit).toBe(commit?.commit);
    expect(run?.changedFiles).toEqual(paths);
    expect(run?.outcome?.status).toBe("done");
  });

  it("starts the Task's first Stage on the fresh base, telling its Agent", async () => {
    pipelines = await startPipelinesApplication([anAgentSession(aDoneResult())]);
    const taskId = randomUUID();
    const commit = "b".repeat(40);
    pipelines.git.branchUpdates.set(taskId, { kind: "updated", commit });
    pipelines.git.unchanged.add(taskId);

    await walkStages(pipelines, [implement], taskId);

    const [run] = await runsOf(pipelines, taskId);
    expect(run?.headCommit).toBe(commit);
    // The base's merge isn't the Stage's own change.
    expect(run?.changedFiles).toEqual([]);
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
    expect(moved?.changedFiles).toEqual([]);
    expect(pipelines.stageThreads.ended[1]?.closing).toEqual({ kind: "failure", reason: error });
    expect(again?.stageKey).toBe("implement");
    expect(again?.outcome).toEqual({
      status: "failed",
      error: `The Task's worktree isn't where The Office left it: HEAD moved from ${implemented?.commit.slice(0, 8)} to ffffffff. The Stage didn't start.`,
      branchMoved: true,
    });
    expect(again?.changedFiles).toEqual([]);
    expect(pipelines.stageThreads.requests).toHaveLength(2);
  });
});
