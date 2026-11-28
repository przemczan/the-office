import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { INestApplication } from "@nestjs/common";
import {
  pipelineSchema,
  stagesCheckSchema,
  taskStagesSchema,
  type Stage,
} from "@the-office/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  addTestProject,
  checkApi,
  cleanUpTestProject,
  git,
  hireOnHaiku,
  openDecisionsOn,
  planOnQuickFix,
  stageLines,
  stagesOf,
  tokensOf,
  untilWalkStops,
  type CheckTask,
} from "../../../../test/live-check.js";
import { startTestApplication } from "../../../../test/test-application.js";
import { testDatabaseUrl } from "../../../../test/test-database.js";
import { AppModule } from "../../../app.module.js";
import { EngineSessions } from "../../engine/index.js";
import { StageInterpreter } from "./stage-interpreter.js";
import { GITHUB_SITE } from "../../../platform/config/github-site.js";

/**
 * Task 15's check on the Test Project: a Ready Task on Quick fix is edited for the Task through the
 * API, as the Stage editor saves it: a Gate before Publish, and Implement on low effort. The walk
 * must run the edited copy, Implement's session on the Stage's effort (its model the engine
 * cascade's), and wait at the Gate; the library's Quick fix stays as it was. The Task is dropped at
 * the Gate, so nothing is published, and its base is a local branch that tracks no remote, so
 * Publish could not leave the workstation anyway. Live, so it runs only with
 * OFFICE_ENGINE_TESTS=live and OFFICE_TEST_PROJECT=<the Test Project's folder>, with
 * OFFICE_CHECK_REPORT=<a file> to keep what it saw. It hires the Planner and the Developer from
 * their presets, so it runs alone.
 */
const MODE = process.env["OFFICE_ENGINE_TESTS"];
const TEST_PROJECT = process.env["OFFICE_TEST_PROJECT"];
const REPORT = process.env["OFFICE_CHECK_REPORT"];
const WEB_APP = fileURLToPath(new URL("../../../../../web", import.meta.url));
const PLANNER_OPENING_MS = 240_000;
/** How long the walk may take to reach the Gate: the install before the first run takes the longest. */
const WALK_MS = 30 * 60_000;

const README_LINE = "Edited for this Task by The Office's check of task 15.";
const TASK: CheckTask = {
  title: "Say on the README that The Office edited this Task's Stages",
  notes: "A one-line change to check Edit for this Task.",
  plan: [
    `Add one line at the very end of README.md, at the repository's root: ${README_LINE}`,
    "Change nothing else.",
  ].join("\n\n"),
  definitionOfDone: [
    `README.md ends with the line "${README_LINE}"`,
    "No other file is changed, and npm test passes.",
  ],
};

/** Added before Publish: Implement → Tests → Look → Publish. */
const GATE: Stage = { kind: "gate", key: "look", name: "Look", optional: false };

describe.runIf(MODE === "live" && TEST_PROJECT !== undefined)(
  "Task 15's check on the Test Project",
  () => {
    it(
      "runs a Ready Task's Stages as edited for the Task: Implement on its own effort, then waits at an added Gate",
      async () => {
        const testProject = TEST_PROJECT ?? "";
        const scratch = await mkdtemp(join(tmpdir(), "office-stage-editor-check-"));
        const officeData = join(scratch, "office-data");
        const report: string[] = [];
        const begun = Date.now();
        const note = async (...lines: string[]): Promise<void> => {
          const seconds = Math.round((Date.now() - begun) / 1000);
          report.push(...lines.map((line, i) => (i === 0 ? `[${seconds} s] ${line}` : line)));
          // For the task's Progress log: vitest keeps a passing test's console to itself.
          if (REPORT) await writeFile(REPORT, `${report.join("\n")}\n`);
        };
        const base = `office-check-15-${randomBytes(4).toString("hex")}`;
        const mainBefore = await git(testProject, "rev-parse", "main");
        let app: INestApplication | undefined;
        let taskId: string | undefined;
        try {
          await git(testProject, "fetch", "origin", "main");
          await git(testProject, "branch", "--no-track", base, "origin/main");
          await refuseIfTracked(testProject, base);

          let url: string;
          ({ app, url } = await startTestApplication({
            imports: [
              AppModule.register(
                {
                  host: "127.0.0.1",
                  port: 0,
                  databaseUrl: testDatabaseUrl(),
                  officeDataDirectory: officeData,
                  gitHub: GITHUB_SITE,
                },
                { directory: WEB_APP, source: "built" },
              ),
            ],
          }));
          const { api } = checkApi(url);
          const sessionStarts = vi.spyOn(app.get(EngineSessions, { strict: false }), "start");
          await hireOnHaiku(api, [
            ["planner", "Jan"],
            ["developer", "Ada"],
          ]);
          const project = await addTestProject(api, testProject, {
            baseBranch: base,
            publishingMode: "merge",
          });
          await note(`Project on ${project.baseBranch}, a local branch with no upstream`);

          const planned = await planOnQuickFix(api, project, TASK, PLANNER_OPENING_MS);
          taskId = planned.taskId;
          await note(
            `Task ${taskId} Ready; Planning Thread tokens ${tokensOf(planned.tokens)} ${JSON.stringify(planned.tokens)}`,
          );

          const followed = taskStagesSchema.parse(await api("GET", `/tasks/${taskId}/stages`));
          expect(followed.stages).toBeNull();
          const library = pipelineSchema.parse(await api("GET", "/pipelines/quick-fix"));
          const edited = editedForTheCheck(library.stages);
          const check = stagesCheckSchema.parse(
            await api("POST", `/tasks/${taskId}/stages/check`, { stages: edited }),
          );
          expect(check.problems).toEqual([]);
          const saved = taskStagesSchema.parse(
            await api("PUT", `/tasks/${taskId}/stages`, { stages: edited }),
          );
          const libraryAfter = pipelineSchema.parse(await api("GET", "/pipelines/quick-fix"));
          await note(
            `Edited for this Task: ${saved.stages?.map(({ stage }) => stage.name).join(" → ") ?? "none"}; editedForTask ${saved.editedForTask}, locked ${saved.lockedStages}`,
            `  Library Quick fix: ${libraryAfter.stages.map(({ name }) => name).join(" → ")}`,
          );
          expect(saved.editedForTask).toBe(true);
          expect(saved.lockedStages).toBe(0);
          expect(saved.stages?.map(({ stage }) => stage)).toEqual(edited);
          expect(libraryAfter).toEqual(library);

          await api("POST", `/tasks/${taskId}/start`);
          const task = await untilWalkStops(api, taskId, WALK_MS);
          const atGate = await stagesOf(api, taskId);
          const gate = atGate.find(({ stage }) => stage.key === GATE.key);
          const waitingAtGate =
            task.state === "waiting-on-you" &&
            (await openDecisionsOn(api, taskId)).length === 0 &&
            gate?.state === "waiting-on-you" &&
            gate.runs.at(-1)?.gateAction === null;
          // The Stage Threads name the Stage each session works, on its spans.
          const started = sessionStarts.mock.calls.map(([{ settings }]) => ({
            stage: settings.telemetry?.span["office.stage"] ?? "no Stage",
            model: settings.model,
            effort: settings.effort,
          }));
          const implementSessions = started.filter(({ stage }) => stage === "Implement");
          await note(
            `Task ${task.state}; waiting at the Gate: ${waitingAtGate}`,
            ...started.map(
              ({ stage, model, effort }) => `  ${stage}: session on ${model} (${effort})`,
            ),
          );
          expect(waitingAtGate).toBe(true);
          expect(implementSessions.length).toBeGreaterThan(0);
          for (const session of implementSessions) expect(session.effort).toBe("low");

          await api("POST", `/tasks/${taskId}/gate/drop`);
          const dropped = await untilWalkStops(api, taskId, WALK_MS);
          await app.get(StageInterpreter, { strict: false }).walked(taskId);
          for (const stage of await stagesOf(api, taskId)) {
            await note(...(await stageLines(api, stage)));
          }
          await note(`Dropped at the Gate: ${dropped.state}`);
          expect(dropped.state).toBe("dropped");
          expect(await git(testProject, "rev-parse", "main")).toBe(mainBefore);
        } finally {
          await app?.close();
          await cleanUpTestProject(testProject, { base, taskIds: [taskId], officeData });
          await note("Cleaned up the Task's worktree and branch, and the base branch");
          await rm(scratch, { recursive: true, force: true });
        }
      },
      PLANNER_OPENING_MS * 2 + WALK_MS,
    );
  },
);

/** Quick fix as the check edits it for the Task: Implement on its own effort, a Gate before Publish. */
function editedForTheCheck(stages: readonly Stage[]): Stage[] {
  const onItsOwnEffort = stages.map((stage) =>
    stage.kind === "agent" && stage.key === "implement"
      ? { ...stage, effort: "low" as const }
      : stage,
  );
  const publishAt = onItsOwnEffort.findIndex(({ key }) => key === "publish");
  if (publishAt < 0) throw new Error("Quick fix has no Publish.");
  return onItsOwnEffort.toSpliced(publishAt, 0, GATE);
}

/** Throws unless `branch` tracks no remote branch, so Publish could only fail on it. */
async function refuseIfTracked(repositoryPath: string, branch: string): Promise<void> {
  const upstream = await git(repositoryPath, "rev-parse", "--abbrev-ref", `${branch}@{u}`).catch(
    () => undefined,
  );
  if (upstream !== undefined) throw new Error(`Refusing: ${branch} tracks ${upstream}.`);
}
