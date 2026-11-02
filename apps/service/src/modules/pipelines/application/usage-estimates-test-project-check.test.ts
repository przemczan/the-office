import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { INestApplication } from "@nestjs/common";
import {
  ideaSchema,
  pipelineSchema,
  queueSchema,
  stagesCheckSchema,
  startAnswerSchema,
  startCheckSchema,
  taskSchema,
  usageSettingsSchema,
  type Project,
  type Stage,
  type Task,
  type UsageSettings,
} from "@the-office/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  addTestProject,
  checkApi,
  cleanUpTestProject,
  git,
  hireOnHaiku,
  openDecisionsOn,
  untilWalkStops,
  type Api,
} from "../../../../test/live-check.js";
import { startTestApplication } from "../../../../test/test-application.js";
import { testDatabaseUrl } from "../../../../test/test-database.js";
import { AppModule } from "../../../app.module.js";
import { GITHUB_SITE } from "../../../platform/git-identity/github-site.js";
import type { StageRun } from "../domain/stage-run.js";
import { StageRunRepository } from "../ports/stage-run-repository.js";
import { StageInterpreter } from "./stage-interpreter.js";
import { UsageHistory } from "./usage-history.js";

/** What the Agent SDK's usage query answered, each time, before the adapter reads it. */
const usageAnswers = vi.hoisted((): { readonly at: Date; readonly answer: unknown }[] => []);

vi.mock("../../engine/adapters/claude-code/sdk-events.js", async (importOriginal) => {
  const original: { usageWindows: (answer: unknown) => unknown } = await importOriginal();
  return {
    ...original,
    usageWindows: (answer: { rate_limits_available: unknown; rate_limits: unknown }) => {
      usageAnswers.push({
        at: new Date(),
        answer: {
          rate_limits_available: answer.rate_limits_available,
          rate_limits: answer.rate_limits,
        },
      });
      return original.usageWindows(answer);
    },
  };
});

/**
 * Task 37's check on the Test Project (docs/tasks/37-usage-estimates.md, step 7): two one-line
 * Tasks on Quick fix edited down to Implement, on the Agent SDK engine and Haiku. The first runs to
 * Done; its Stage run's readings, the usage query's raw answers and the history's samples show how
 * fine `utilization` is. Then the Claude Code engines' 5-hour cap is lowered below the use, so the
 * second Task's Start waits in the queue with the cap's words, and raised again, which releases it
 * to run to Done. No Planner session runs: the user writes each Plan. Nothing is published: the
 * Pipeline has no Publish, and the base is a local branch with no upstream. Live, so it runs only
 * with OFFICE_ENGINE_TESTS=live and OFFICE_TEST_PROJECT=<the Test Project's folder>, with
 * OFFICE_CHECK_REPORT=<a file> to keep what it saw. It hires from the presets, so it runs alone.
 */
const MODE = process.env["OFFICE_ENGINE_TESTS"];
const TEST_PROJECT = process.env["OFFICE_TEST_PROJECT"];
const REPORT = process.env["OFFICE_CHECK_REPORT"];
const WEB_APP = fileURLToPath(new URL("../../../../../web", import.meta.url));
/** How long a walk may take: the worktree's install before the first run takes the longest. */
const WALK_MS = 30 * 60_000;
const RELEASE_MS = 60_000;
const HOUR_MS = 60 * 60_000;
/** The second Task's Planner's estimate, so its Start weighs an estimate drawn from the first run. */
const PLANNER_TOKENS = 40_000;

const taskOf = (line: string) => ({
  title: `Say on the README: ${line}`,
  plan: [
    `Add one line at the very end of README.md, at the repository's root: ${line}`,
    "Change nothing else.",
  ].join("\n\n"),
  definitionOfDone: [`README.md ends with the line "${line}"`, "No other file is changed."],
});
const FIRST = taskOf("Usage estimates were checked by The Office's check of task 37.");
const SECOND = taskOf("The Office's check of task 37 waited on a cap, then started.");

describe.runIf(MODE === "live" && TEST_PROJECT !== undefined)(
  "Task 37's check on the Test Project",
  () => {
    it(
      "keeps a Stage run's readings, and holds a Start on a lowered 5-hour cap until it is raised",
      async () => {
        const testProject = TEST_PROJECT ?? "";
        const scratch = await mkdtemp(join(tmpdir(), "office-usage-check-"));
        const officeData = join(scratch, "office-data");
        const report: string[] = [];
        const begun = Date.now();
        const note = async (...lines: string[]): Promise<void> => {
          const seconds = Math.round((Date.now() - begun) / 1000);
          report.push(...lines.map((line, i) => (i === 0 ? `[${seconds} s] ${line}` : line)));
          // For the task's State: vitest keeps a passing test's console to itself.
          if (REPORT) await writeFile(REPORT, `${report.join("\n")}\n`);
        };
        const noteUsageAnswers = async (): Promise<void> => {
          await note(
            "Usage query answers so far:",
            ...usageAnswers.map(
              ({ at, answer }) => `  ${at.toISOString()} ${JSON.stringify(answer)}`,
            ),
          );
        };
        const base = `office-check-37-${randomBytes(4).toString("hex")}`;
        const taskIds: string[] = [];
        let app: INestApplication | undefined;
        try {
          await git(testProject, "fetch", "origin", "main");
          await git(testProject, "branch", "--no-track", base, "origin/main");

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
          const runs = app.get(StageRunRepository, { strict: false });
          const history = app.get(UsageHistory, { strict: false });
          const interpreter = app.get(StageInterpreter, { strict: false });
          await hireOnHaiku(api, [
            ["planner", "Jan"],
            ["developer", "Ada"],
          ]);
          const project = await addTestProject(api, testProject, {
            baseBranch: base,
            publishingMode: "merge",
          });
          const implementOnly = implementStageOf(
            pipelineSchema.parse(await api("GET", "/pipelines/quick-fix")).stages,
          );

          const first = await readyTask(api, project, FIRST, implementOnly);
          taskIds.push(first);
          await api("POST", `/tasks/${first}/start`);
          await note(`First Task ${first} started`);
          expect((await untilDone(api, first)).state).toBe("done");
          await interpreter.walked(first);
          const firstRuns = await runs.list(first);
          await note(...firstRuns.flatMap(runLines));
          await noteUsageAnswers();

          const lastReading = firstRuns.at(-1)?.usageWindowsAtEnd;
          if (!lastReading) throw new Error("The first run kept no reading at its end.");
          const used = lastReading.fiveHour.percentUsed;
          const resetsAt = lastReading.fiveHour.resetsAt;
          const cap = Math.ceil(used) - 1;
          await note(
            `5-hour window at the first run's end: ${used}% used, resets ${resetsAt?.toISOString() ?? "never read"}; cap to set ${cap}%`,
          );
          if (cap < 1)
            throw new Error(`The 5-hour window reads ${used}%: no cap of 1% or more is under it.`);
          if (resetsAt !== undefined && resetsAt.getTime() - Date.now() <= HOUR_MS) {
            throw new Error(
              "The 5-hour window resets within the hour, so a Start would go anyway.",
            );
          }

          const settings = usageSettingsSchema.parse(await api("GET", "/settings/usage"));
          await note(`Usage settings: ${JSON.stringify(settings)}`);
          await api("PUT", "/settings/usage", withFiveHourCap(settings, cap));
          const second = await readyTask(api, project, SECOND, implementOnly, PLANNER_TOKENS);
          taskIds.push(second);
          const checked = startCheckSchema.parse(await api("GET", `/tasks/${second}/start`));
          await note(`Second Task ${second}: start check ${JSON.stringify(checked)}`);
          const started = startAnswerSchema.parse(await api("POST", `/tasks/${second}/start`));
          await note(
            `Start with the 5-hour cap at ${cap}%: ${started.task.state}, queued ${JSON.stringify(started.queued)}`,
          );
          expect(started.task.state).toBe("ready");
          expect(started.queued?.reasons.join(" ")).toContain("5-hour window");

          await api("PUT", "/settings/usage", settings);
          const released = await vi.waitFor(
            async () => {
              const task = taskSchema.parse(await api("GET", `/tasks/${second}`));
              if (task.state === "ready") throw new Error("Still queued.");
              return task;
            },
            { timeout: RELEASE_MS, interval: 1_000 },
          );
          const queue = queueSchema.parse(await api("GET", "/queue"));
          await note(
            `Cap given back (${JSON.stringify(settings.caps)}): ${released.state}, queue ${JSON.stringify(queue)}`,
          );
          expect(released.state).toBe("in-progress");

          expect((await untilDone(api, second)).state).toBe("done");
          await interpreter.walked(second);
          await note(...(await runs.list(second)).flatMap(runLines));
          await noteUsageAnswers();
          const usages = await history.of([first, second]);
          await note(
            "History of both Tasks:",
            ...[...usages].map(([stageKey, usage]) => `  ${stageKey}: ${JSON.stringify(usage)}`),
          );
        } finally {
          await app?.close();
          for (const taskId of taskIds)
            await cleanUpTestProject(testProject, { taskId, officeData });
          await cleanUpTestProject(testProject, { base, taskId: undefined, officeData });
          await note("Cleaned up the Tasks' worktrees and branches, and the base branch");
          await rm(scratch, { recursive: true, force: true });
        }
      },
      WALK_MS * 2 + RELEASE_MS,
    );
  },
);

/** A Ready Task on Quick fix edited down to `stages`, its Plan written by the user. */
async function readyTask(
  api: Api,
  project: Project,
  task: ReturnType<typeof taskOf>,
  stages: readonly Stage[],
  estimatedTokens?: number,
): Promise<string> {
  const idea = ideaSchema.parse(
    await api("POST", "/ideas", { title: task.title, notes: "", projectId: project.id }),
  );
  const taskId = taskSchema.parse(
    await api("POST", `/ideas/${idea.id}/shape`, { projectId: project.id }),
  ).id;
  await api("POST", `/tasks/${taskId}/planning`);
  await api("PUT", `/tasks/${taskId}/plan`, { plan: task.plan, estimatedTokens });
  await api("PUT", `/tasks/${taskId}/definition-of-done`, {
    definitionOfDone: task.definitionOfDone,
  });
  await api("PUT", `/tasks/${taskId}/pipeline`, { pipelineId: "quick-fix" });
  const check = stagesCheckSchema.parse(
    await api("POST", `/tasks/${taskId}/stages/check`, { stages }),
  );
  expect(check.problems).toEqual([]);
  await api("PUT", `/tasks/${taskId}/stages`, { stages });
  expect(taskSchema.parse(await api("POST", `/tasks/${taskId}/ready`)).state).toBe("ready");
  return taskId;
}

/** Quick fix's Implement alone: no Tests and no Publish, so nothing installs or leaves. */
function implementStageOf(stages: readonly Stage[]): Stage[] {
  const implement = stages.find(({ key }) => key === "implement");
  if (!implement) throw new Error("Quick fix has no Implement.");
  return [implement];
}

/** Waits for Done, marking the Task Done when the walk asks whether its Definition of Done is met. */
async function untilDone(api: Api, taskId: string): Promise<Task> {
  let task = await untilWalkStops(api, taskId, WALK_MS);
  for (const asked of await openDecisionsOn(api, taskId)) {
    const markDone = asked.options.indexOf("Mark the Task Done");
    if (markDone < 0) break;
    await api("POST", `/decisions/${asked.id}/answer`, { kind: "option", option: markDone });
    task = await untilWalkStops(api, taskId, WALK_MS);
  }
  return task;
}

function runLines(run: StageRun): string[] {
  return [
    `Run ${run.number} of ${run.stageKey} on ${run.engine ?? "no engine"} / ${run.model ?? "no model"}, tokens ${JSON.stringify(run.tokens)}`,
    `  at start: ${JSON.stringify(run.usageWindowsAtStart ?? null)}`,
    `  at end:   ${JSON.stringify(run.usageWindowsAtEnd ?? null)}`,
  ];
}

/** The settings with the Claude Code engines' 5-hour Window cap at `cap`. */
function withFiveHourCap(settings: UsageSettings, cap: number): UsageSettings {
  return {
    ...settings,
    caps: settings.caps.map((caps) =>
      caps.windows ? { ...caps, windows: { ...caps.windows, fiveHour: cap } } : caps,
    ),
  };
}
