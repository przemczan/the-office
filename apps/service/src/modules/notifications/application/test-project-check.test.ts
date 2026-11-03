import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { INestApplication } from "@nestjs/common";
import {
  countedTokens,
  nowSchema,
  pipelineSchema,
  type Now,
  type Stage,
} from "@the-office/contracts";
import { describe, expect, it } from "vitest";
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
  type Api,
  type CheckTask,
} from "../../../../test/live-check.js";
import { startTestApplication } from "../../../../test/test-application.js";
import { testDatabaseUrl } from "../../../../test/test-database.js";
import { AppModule } from "../../../app.module.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import { NotificationRaised, NotificationsCleared } from "../domain/notification-events.js";
import type { Notification } from "../domain/notification.js";
import { NowChanged } from "../domain/now-events.js";
import { GITHUB_SITE } from "../../../platform/git-identity/github-site.js";

/**
 * Task 16's check on the Test Project (docs/tasks/16-now-notifications.md, step 6): a day's loop
 * seen from Now and as Notifications. The Planner plans a Task (answering its Decisions), the Task
 * runs Quick fix edited for it, with Implement's budget at what planning used, so The Office asks
 * to raise it, and a Gate in place of Publish; the user answers and continues from what waits,
 * the Task ends Done, and the user opens it. Every Notification raised and cleared, and Now at
 * each stop, go into the report. Nothing is published, and the base is a local branch that
 * tracks no remote. Live, so it runs only with OFFICE_ENGINE_TESTS=live and
 * OFFICE_TEST_PROJECT=<the Test Project's folder>, with OFFICE_CHECK_REPORT=<a file> to keep what
 * it saw. It hires the Planner and the Developer from their presets, so it runs alone.
 */
const MODE = process.env["OFFICE_ENGINE_TESTS"];
const TEST_PROJECT = process.env["OFFICE_TEST_PROJECT"];
const REPORT = process.env["OFFICE_CHECK_REPORT"];
const WEB_APP = fileURLToPath(new URL("../../../../../web", import.meta.url));
const PLANNER_OPENING_MS = 240_000;
/** How long the walk may take to stop: the install before the first run takes the longest. */
const WALK_MS = 30 * 60_000;
/** Each Decision answered and the Gate continued are stops; more means the loop went round. */
const MOST_STOPS = 8;

const README_LINE = "Seen from Now by The Office's check of task 16.";
const TASK: CheckTask = {
  title: "Say on the README that The Office's Now saw this Task",
  notes: "A one-line change to check Now and Notifications.",
  plan: [
    `Add one line at the very end of README.md, at the repository's root: ${README_LINE}`,
    "Change nothing else.",
  ].join("\n\n"),
  definitionOfDone: [
    `README.md ends with the line "${README_LINE}"`,
    "No other file is changed, and npm test passes.",
  ],
};

/** In place of Publish, so the Task ends Done with nothing leaving the workstation. */
const GATE: Stage = { kind: "gate", key: "look", name: "Look", optional: false };

describe.runIf(MODE === "live" && TEST_PROJECT !== undefined)(
  "Task 16's check on the Test Project",
  () => {
    it(
      "shows a day's loop on Now and as Notifications, each cleared once handled",
      async () => {
        const testProject = TEST_PROJECT ?? "";
        const scratch = await mkdtemp(join(tmpdir(), "office-now-check-"));
        const officeData = join(scratch, "office-data");
        const report: string[] = [];
        const begun = Date.now();
        const note = async (...lines: string[]): Promise<void> => {
          const seconds = Math.round((Date.now() - begun) / 1000);
          report.push(...lines.map((line, i) => (i === 0 ? `[${seconds} s] ${line}` : line)));
          // For the task's Progress log: vitest keeps a passing test's console to itself.
          if (REPORT) await writeFile(REPORT, `${report.join("\n")}\n`);
        };
        const base = `office-check-16-${randomBytes(4).toString("hex")}`;
        const mainBefore = await git(testProject, "rev-parse", "main");
        let app: INestApplication | undefined;
        let taskId: string | undefined;
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
          const raised = new Map<string, Notification>();
          const cleared = new Set<string>();
          let nowChanges = 0;
          const events = app.get(EventBus);
          events.subscribe(NotificationRaised, async ({ notification }) => {
            raised.set(notification.id, notification);
            await note(`Notification raised: ${notificationLine(notification)}`);
          });
          events.subscribe(NotificationsCleared, async ({ notificationIds }) => {
            for (const id of notificationIds) cleared.add(id);
            const kinds = notificationIds.map((id) => raised.get(id)?.kind ?? `an earlier one`);
            await note(`Notifications cleared: ${kinds.join(", ")}`);
          });
          events.subscribe(NowChanged, () => void nowChanges++);

          await hireOnHaiku(api, [
            ["planner", "Jan"],
            ["developer", "Ada"],
          ]);
          const project = await addTestProject(api, testProject, {
            baseBranch: base,
            publishingMode: "merge",
          });
          await api("POST", "/activity", { page: { kind: "now" } });
          await note(`Project on ${project.baseBranch}, a local branch with no upstream`);

          const planned = await planOnQuickFix(api, project, TASK, PLANNER_OPENING_MS);
          taskId = planned.taskId;
          // Budgets leave cache reads out, so what planning used counts the other three kinds.
          const { input, output, cacheCreation } = planned.tokens;
          const planningBudgetTokens = input + output + cacheCreation;
          await note(
            `Task ${taskId} Ready; Planning Thread tokens ${tokensOf(planned.tokens)}, ${planningBudgetTokens} as budgets count them`,
          );

          const library = pipelineSchema.parse(await api("GET", "/pipelines/quick-fix"));
          await api("PUT", `/tasks/${taskId}/stages`, {
            stages: editedForTheCheck(library.stages, planningBudgetTokens),
          });
          await api("POST", `/tasks/${taskId}/start`);
          await note(...(await nowLines(api, "after Start")));

          let stops = 0;
          let task = await untilWalkStops(api, taskId, WALK_MS);
          while (task.state === "waiting-on-you" && stops < MOST_STOPS) {
            stops++;
            await note(...(await nowLines(api, `stop ${stops}, ${task.state}`)));
            const waiting = await openDecisionsOn(api, taskId);
            for (const decision of waiting) {
              const option = decision.recommendation.option;
              await note(`Answering "${decision.question}" with "${decision.options[option]}"`);
              await api("POST", `/decisions/${decision.id}/answer`, { kind: "option", option });
            }
            if (waiting.length === 0) {
              await note("Continuing at the Gate");
              await api("POST", `/tasks/${taskId}/gate/continue`);
            }
            task = await untilWalkStops(api, taskId, WALK_MS);
          }
          await note(...(await nowLines(api, `the walk stopped ${task.state}`)));
          for (const stage of await stagesOf(api, taskId)) {
            await note(...(await stageLines(api, stage)));
          }
          expect(task.state).toBe("done");

          // The user opens the Task, which handles its outcome on every channel.
          await api("POST", "/activity", { page: { kind: "task", taskId } });
          const now = nowSchema.parse(await api("GET", "/now"));
          const own = [...raised.values()].filter(
            ({ pointsTo }) => "taskId" in pointsTo && pointsTo.taskId === taskId,
          );
          await note(
            `Now changed ${nowChanges} times; ${own.length} Notifications on the Task, ${own.filter(({ id }) => cleared.has(id)).length} cleared`,
            ...(await nowLines(api, "after opening the Task")),
          );
          expect(own.map(({ kind }) => kind)).toEqual(
            expect.arrayContaining(["needs-you.decision", "needs-you.gate", "outcomes.task-done"]),
          );
          for (const notification of own) {
            expect(notification.channels).toEqual(expect.arrayContaining(["in-app", "desktop"]));
            expect(cleared.has(notification.id)).toBe(true);
          }
          expect(now.needsYou.filter((item) => item.taskId === taskId)).toEqual([]);
          expect(now.sinceYouLeft).toContainEqual(
            expect.objectContaining({ taskId, outcome: "done" }),
          );
          expect(await git(testProject, "rev-parse", "main")).toBe(mainBefore);
        } finally {
          await app?.close();
          await cleanUpTestProject(testProject, { base, taskId, officeData });
          await note("Cleaned up the Task's worktree and branch, and the base branch");
          await rm(scratch, { recursive: true, force: true });
        }
      },
      PLANNER_OPENING_MS * 2 + WALK_MS * 3,
    );
  },
);

/**
 * Quick fix as the check edits it for the Task: Implement's budget at what planning used, so The
 * Office asks to raise it before the first call, and a Gate in place of Publish.
 */
function editedForTheCheck(stages: readonly Stage[], budget: number): Stage[] {
  return stages.flatMap((stage): Stage[] => {
    if (stage.kind === "agent" && stage.key === "implement") return [{ ...stage, budget }];
    if (stage.key === "publish") return [GATE];
    return [stage];
  });
}

function notificationLine({ kind, channels, roleKey, line }: Notification): string {
  return `${kind} to ${channels.join(" and ")}, ${roleKey ?? "The Office"}: "${line}"`;
}

/** What Now and the status strip showed at a stop of the walk. */
async function nowLines(api: Api, when: string): Promise<string[]> {
  const now: Now = nowSchema.parse(await api("GET", "/now"));
  return [
    `Now, ${when}: ${now.needsYou.length} need you (${now.needsYou.map(({ kind }) => kind).join(", ") || "none"})`,
    ...now.running.map(
      ({ title, state, stage }) =>
        `  running: ${title} · ${state} · ${stage ? `${stage.name} (${stage.role ?? "no Agent"}) since ${stage.since}` : "no Stage yet"}`,
    ),
    `  since you left (from ${now.leftAt ?? "never"}): ${now.sinceYouLeft.map(({ title, outcome }) => `${outcome} ${title}`).join("; ") || "nothing"}`,
    `  strip: ${countedTokens(now.tokensToday)} tokens today ${JSON.stringify(now.tokensToday)}, desks ${now.desks.inUse} of ${now.desks.limit}, ${now.tasksTouched} Tasks touched, usage windows ${now.usageWindows.length > 0 ? now.usageWindows.map(({ engineId, fiveHour, sevenDay }) => `${engineId} 5h ${fiveHour.percentUsed}% 7d ${sevenDay.percentUsed}%`).join(", ") : "not read yet"}`,
  ];
}
