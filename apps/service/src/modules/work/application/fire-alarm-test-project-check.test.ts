import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { INestApplication } from "@nestjs/common";
import {
  fireAlarmSchema,
  messageListSchema,
  nowSchema,
  pipelineSchema,
  stagesCheckSchema,
  taskSchema,
  taskStagesSchema,
  type FireAlarmOnNow,
  type StageRun,
} from "@the-office/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  addTestProject,
  checkApi,
  cleanUpTestProject,
  git,
  hireOnHaiku,
  planOnQuickFix,
  stageLines,
  stagesOf,
  tokensOf,
  untilWalkStops,
  type Api,
  type CheckTask,
} from "../../../../test/live-check.js";
import { startTestApplication } from "../../../../test/test-application.js";
import { testDatabaseUrl } from "../../../../test/test-database.js";
import { AppModule } from "../../../app.module.js";
import { FireAlarmRepository } from "../ports/fire-alarm-repository.js";
import { FireAlarmRepositoryForTests } from "../ports/work-ports.fixtures.js";
import { GITHUB_SITE } from "../../../platform/git-identity/github-site.js";

/**
 * Task 27's check on the Test Project (docs/tasks/27-notifications-and-fire-alarm.md): a Task whose
 * only Stage is Quick fix's Implement, worked by the Developer on Haiku. The user sounds the alarm
 * at the Agent's first tool call; Now shows it stopping, the turn ends at its safe point (before the
 * hard stop) and the run is held by the alarm; the all clear's plan says the Stage continues warm,
 * and after the all clear the Stage goes on in the same session. The alarm is the check's own, never
 * the stored one. Live, so it runs only when asked: OFFICE_ENGINE_TESTS=live and
 * OFFICE_TEST_PROJECT=<the Test Project's folder>, with OFFICE_CHECK_REPORT=<a file> to keep what it
 * saw; OFFICE_CHECK_PAGE_HOLD_MS keeps the service up that long while the alarm is on, to look at
 * Now's plan. It hires the Planner and the Developer from their presets, so it runs alone.
 */
const MODE = process.env["OFFICE_ENGINE_TESTS"];
const TEST_PROJECT = process.env["OFFICE_TEST_PROJECT"];
const REPORT = process.env["OFFICE_CHECK_REPORT"];
const PAGE_HOLD_MS = Number(process.env["OFFICE_CHECK_PAGE_HOLD_MS"] ?? "0");
const WEB_APP = fileURLToPath(new URL("../../../../../web", import.meta.url));
const PLANNER_OPENING_MS = 240_000;
/** How long one move of the check may wait: the install before the first run takes the longest. */
const MOVE_MS = 15 * 60_000;
const WALK_MS = 15 * 60_000;

/** A change small enough for the Agent's turn to end well inside the alarm's hard stop. */
const TASK: CheckTask = {
  title: "Name the health check in the README",
  notes: "So a reader knows the server can be checked.",
  plan: "In the root README.md, add one sentence at the end of its first paragraph: “The admin panel's server answers GET /api/health.” Change nothing else and run no commands.",
  definitionOfDone: [
    "The root README.md's first paragraph ends with the sentence about GET /api/health.",
  ],
};

describe.runIf(MODE === "live" && TEST_PROJECT !== undefined)(
  "Task 27's check on the Test Project",
  () => {
    it(
      "sounds the alarm mid-turn, holds the Stage at its safe point, and resumes it warm at the all clear",
      async () => {
        const testProject = TEST_PROJECT ?? "";
        const folder = await mkdtemp(join(tmpdir(), "office-fire-alarm-check-"));
        const officeData = join(folder, "office-data");
        const report: string[] = [];
        const begun = Date.now();
        const note = async (...lines: string[]): Promise<void> => {
          const seconds = Math.round((Date.now() - begun) / 1000);
          report.push(...lines.map((line, i) => (i === 0 ? `[${seconds} s] ${line}` : line)));
          // For the task's Progress log: vitest keeps a passing test's console to itself.
          if (REPORT) await writeFile(REPORT, `${report.join("\n")}\n`);
        };
        const mainBefore = await git(testProject, "rev-parse", "main");
        const fireAlarm = new FireAlarmRepositoryForTests();
        let app: INestApplication | undefined;
        let taskId: string | undefined;
        try {
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
            overrides: [{ provide: FireAlarmRepository, useValue: fireAlarm }],
          }));
          const { api } = checkApi(url);
          await hireOnHaiku(api, [
            ["planner", "Jan"],
            ["developer", "Ada"],
          ]);
          const project = await addTestProject(api, testProject);
          const planned = await planOnQuickFix(api, project, TASK, PLANNER_OPENING_MS);
          taskId = planned.taskId;
          const stageName = await onlyItsAgentStage(api, taskId);
          await note(
            `Task ${taskId} Ready on ${stageName} alone; Planning Thread tokens ${tokensOf(planned.tokens)}`,
          );

          await api("POST", `/tasks/${taskId}/start`);
          const firstThread = await threadOfRun(api, taskId, 1);
          await untilToolActivity(api, firstThread);
          await api("POST", "/fire-alarm/sound");
          const soundedAt = Date.now();
          const stopping = await alarmOnNow(api);
          await note(
            `Sounded at the Agent's first tool call; Now: stopping ${stopping.stopping}, plan ${JSON.stringify(stopping.paused.map(({ resume }) => resume))}`,
          );

          const held = await untilRunEnds(api, taskId, 1);
          const heldAfterMs = Date.parse(held.endedAt ?? "") - soundedAt;
          const pausedTask = taskSchema.parse(await api("GET", `/tasks/${taskId}`));
          const plan = await alarmOnNow(api);
          const resume = plan.paused.find((paused) => paused.taskId === taskId)?.resume;
          await note(
            `Run 1 (${held.session ?? "no session"}) held ${Math.round(heldAfterMs / 1000)} s after the alarm: ${JSON.stringify(held.outcome)}`,
            `  Task ${pausedTask.state}, paused by the alarm: ${pausedTask.pausedByAlarm}`,
            `  Now: stopping ${plan.stopping}, resume ${JSON.stringify(resume)}, total ${plan.resumeTokens}`,
          );

          if (PAGE_HOLD_MS > 0) {
            await note(`Now's plan: ${url}/now, up for ${PAGE_HOLD_MS} ms`);
            await new Promise((resolve) => setTimeout(resolve, PAGE_HOLD_MS));
          }
          await api("POST", "/fire-alarm/all-clear", { hold: [], drop: [] });
          const after = fireAlarmSchema.parse(await api("GET", "/fire-alarm"));
          const resumed = await untilRun(api, taskId, 2);
          await note(
            `All clear: alarm on ${after.on}; run 2 (${resumed.session ?? "no session"}) in ${resumed.threadId === firstThread ? "the same" : "another"} Thread`,
          );

          const task = await untilWalkStops(api, taskId, WALK_MS);
          await note(`Task ${task.state}`);
          for (const stage of await stagesOf(api, taskId)) {
            await note(...(await stageLines(api, stage)));
          }

          expect(stopping.stopping).toBe(true);
          expect(stopping.paused.find((paused) => paused.taskId === taskId)?.resume).toBeNull();
          // Its safe point, the turn's end, came before the hard stop, whose words differ.
          expect(held.outcome).toMatchObject({ status: "failed", interrupted: "alarm" });
          expect(held.outcome?.status === "failed" && held.outcome.error).toMatch(
            /^Held by the fire alarm\. The Stage's uncommitted edits stay/,
          );
          expect(pausedTask).toMatchObject({ state: "paused", pausedByAlarm: true });
          expect(plan.stopping).toBe(false);
          expect(resume).toMatchObject({ kind: "continues-warm", stageName });
          expect(resume?.contextTokens).toBeGreaterThan(0);
          expect(plan.resumeTokens).toBe(resume?.tokens);
          expect(after.on).toBe(false);
          expect(resumed.session).toBe("resume");
          expect(resumed.threadId).toBe(firstThread);
          expect(task.state).toBe("done");
          expect(await git(testProject, "rev-parse", "main")).toBe(mainBefore);
        } finally {
          fireAlarm.turnOff();
          await app?.close();
          await cleanUpTestProject(testProject, { taskIds: [taskId], officeData });
          await rm(folder, { recursive: true, force: true });
        }
      },
      PLANNER_OPENING_MS * 2 + MOVE_MS * 3 + WALK_MS + PAGE_HOLD_MS,
    );
  },
);

/** Edits the Task's Stages down to Quick fix's first, an Agent Stage, so nothing publishes. */
async function onlyItsAgentStage(api: Api, taskId: string): Promise<string> {
  const [first] = pipelineSchema.parse(await api("GET", "/pipelines/quick-fix")).stages;
  if (first?.kind !== "agent") throw new Error("Quick fix doesn't begin with an Agent Stage.");
  const stages = [first];
  const check = stagesCheckSchema.parse(
    await api("POST", `/tasks/${taskId}/stages/check`, { stages }),
  );
  expect(check.problems).toEqual([]);
  taskStagesSchema.parse(await api("PUT", `/tasks/${taskId}/stages`, { stages }));
  return first.name;
}

async function alarmOnNow(api: Api): Promise<FireAlarmOnNow> {
  const { fireAlarm } = nowSchema.parse(await api("GET", "/now"));
  if (!fireAlarm) throw new Error("Now shows no fire alarm.");
  return fireAlarm;
}

async function until<T>(probe: () => Promise<T | undefined>, interval = 1_000): Promise<T> {
  return vi.waitFor(
    async () => {
      const found = await probe();
      if (found === undefined) throw new Error("Not yet.");
      return found;
    },
    { timeout: MOVE_MS, interval },
  );
}

async function runsOf(api: Api, taskId: string): Promise<StageRun[]> {
  return (await stagesOf(api, taskId))
    .flatMap(({ runs }) => runs)
    .toSorted((one, other) => one.number - other.number);
}

async function untilRun(api: Api, taskId: string, number: number): Promise<StageRun> {
  return until(async () => (await runsOf(api, taskId)).find((each) => each.number === number));
}

/** The run's Stage Thread, which opens once its install has ended. */
async function threadOfRun(api: Api, taskId: string, number: number): Promise<string> {
  return until(async () => (await untilRun(api, taskId, number)).threadId ?? undefined);
}

async function untilRunEnds(api: Api, taskId: string, number: number): Promise<StageRun> {
  return until(async () =>
    (await runsOf(api, taskId)).find((each) => each.number === number && each.outcome !== null),
  );
}

/** Waits for the Agent's first tool call in the Thread, polled often so the alarm lands mid-turn. */
async function untilToolActivity(api: Api, threadId: string): Promise<void> {
  await until(async () => {
    const messages = messageListSchema.parse(await api("GET", `/threads/${threadId}/messages`));
    return messages.find((message) => message.kind === "tool-activity");
  }, 250);
}
