import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { INestApplication } from "@nestjs/common";
import {
  ideaSchema,
  messageListSchema,
  taskSchema,
  threadListSchema,
  threadSchema,
  type Message,
  type StageRun,
  type Task,
  type Thread,
} from "@the-office/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  addTestProject,
  checkApi,
  git,
  hireOnHaiku,
  openDecisionsOn,
  stageLines,
  stagesOf,
  tokensOf,
  startPlanner,
  untilThreadWaits,
  type Api,
} from "../../../../test/live-check.js";
import { startTestApplication } from "../../../../test/test-application.js";
import { testDatabaseUrl } from "../../../../test/test-database.js";
import { AppModule } from "../../../app.module.js";
import { builtInPipelines } from "../domain/built-in-pipelines.js";
import { makeTaskStages } from "../domain/task-stages.js";
import { StageThreads } from "../ports/stage-threads.js";
import { TaskStagesRepository } from "../ports/task-stages-repository.js";
import { StageInterpreter } from "./stage-interpreter.js";

/**
 * Task 13's check on the Test Project (docs/tasks/13-running-task.md): a Task on Quick fix without
 * Publish, worked by the Developer on Haiku, which the user steers while it runs. They barge in
 * once, asking for a Decision, and answer it the moment it opens; Stop the run that follows at its
 * first edit and resume it in a fresh session; Pause that run and Resume it. Throughout, the Stage
 * Thread's tokens are read every second, to see them move mid-turn. The Task's branch and worktree
 * are discarded after. Live, so it runs only when asked: OFFICE_ENGINE_TESTS=live and
 * OFFICE_TEST_PROJECT=<the Test Project's folder>, with OFFICE_CHECK_REPORT=<a file> to keep what
 * it saw; OFFICE_CHECK_PAGE_HOLD_MS keeps the service up that long after, to look at the Task page.
 * It hires the Planner and the Developer from their presets, so it runs alone.
 */
const MODE = process.env["OFFICE_ENGINE_TESTS"];
const TEST_PROJECT = process.env["OFFICE_TEST_PROJECT"];
const REPORT = process.env["OFFICE_CHECK_REPORT"];
const PAGE_HOLD_MS = Number(process.env["OFFICE_CHECK_PAGE_HOLD_MS"] ?? "0");
const WEB_APP = fileURLToPath(new URL("../../../../../web", import.meta.url));
const PLANNER_OPENING_MS = 240_000;
/** How long one move of the check may wait: the install before the first run takes the longest. */
const MOVE_MS = 15 * 60_000;
const WALK_MS = 30 * 60_000;
const WATCH_INTERVAL_MS = 1_000;
/** The engine's tools that change files, whose first call the user stops the run at. */
const EDITS: readonly string[] = ["Edit", "Write", "MultiEdit", "NotebookEdit"];
const STOPPED_STATES: readonly Task["state"][] = ["done", "waiting-on-you", "dropped", "paused"];
const run = promisify(execFile);

const PLAN = [
  "In apps/admin-panel/server, make GET /api/health answer { ok: true, version }, the version read from the server package's own package.json.",
  "First read the server's health route, its existing tests and the README's API table, so the change fits them.",
  "Cover it with a test beside the server's existing tests, and update the README's row for GET /api/health.",
].join("\n\n");
const DEFINITION_OF_DONE = [
  "GET /api/health answers ok: true and a version equal to the server package.json's version.",
  "A server test checks the version in the health answer, and npm test passes.",
  "The README's row for GET /api/health names the version.",
];
const BARGE_IN =
  "A note from the user: before you edit any file, ask me with open_decision whether the field in the health answer should be named `version` or `build`, recommending `version`. Then end your turn with needs_decision.";

/** What the check saw of the Stage Thread each second. */
interface Sample {
  readonly at: number;
  /** The Stage Thread of the latest run that has one: a fresh session opens a Thread of its own. */
  readonly threadId: string;
  readonly tokens: number;
  readonly state: Thread["state"];
  /** The number of the Task's run going on then, if any. */
  readonly running: number | undefined;
}

describe.runIf(MODE === "live" && TEST_PROJECT !== undefined)(
  "Task 13's check on the Test Project",
  () => {
    it(
      "barges in, answers a Decision mid-turn, stops and resumes fresh, pauses and resumes, with live tokens",
      async () => {
        const testProject = TEST_PROJECT ?? "";
        const folder = await mkdtemp(join(tmpdir(), "office-running-check-"));
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
        let app: INestApplication | undefined;
        let worktree: { path: string; branch: string } | undefined;
        let watching = true;
        let watcher: Promise<void> | undefined;
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
                },
                { directory: WEB_APP, source: "built" },
              ),
            ],
          }));
          const { api } = checkApi(url);
          await hireOnHaiku(api, [
            ["planner", "Jan"],
            ["developer", "Ada"],
          ]);
          const project = await addTestProject(api, testProject);

          // Planned as in task 12's check: the Planner's opening, then the user writes the parts.
          const idea = ideaSchema.parse(
            await api("POST", "/ideas", {
              title: "Report the build version on the health check",
              notes: "So we can tell which build is deployed.",
              projectId: project.id,
            }),
          );
          const taskId = taskSchema.parse(
            await api("POST", `/ideas/${idea.id}/shape`, { projectId: project.id }),
          ).id;
          await api("POST", `/tasks/${taskId}/planning`);
          worktree = {
            path: join(officeData, "worktrees", project.id, taskId),
            branch: `office/${taskId}`,
          };
          const planningThread = threadListSchema.parse(
            await api("GET", `/tasks/${taskId}/threads`),
          )[0];
          if (!planningThread) throw new Error("Planning opened no Thread.");
          await startPlanner(api, planningThread.id, PLANNER_OPENING_MS);
          for (const asked of await openDecisionsOn(api, taskId)) {
            await api("POST", `/decisions/${asked.id}/answer`, {
              kind: "option",
              option: asked.recommendation.option,
            });
          }
          await untilThreadWaits(api, planningThread.id, PLANNER_OPENING_MS);
          await api("PUT", `/tasks/${taskId}/plan`, { plan: PLAN });
          await api("PUT", `/tasks/${taskId}/definition-of-done`, {
            definitionOfDone: DEFINITION_OF_DONE,
          });
          await api("PUT", `/tasks/${taskId}/pipeline`, { pipelineId: "quick-fix" });
          expect(taskSchema.parse(await api("POST", `/tasks/${taskId}/ready`)).state).toBe("ready");

          // Quick fix without Publish (task 14), seeded as the Task's own Stages.
          const quickFix = builtInPipelines.find(({ id }) => id === "quick-fix");
          if (!quickFix) throw new Error("There is no built-in Quick fix.");
          const stages = quickFix.stages.filter((stage) => stage.key !== "publish");
          const { taskStages } = makeTaskStages(taskId, { ...quickFix, stages }, new Date());
          const repository = app.get(TaskStagesRepository, { strict: false });
          await repository.save(taskStages);

          // The work each run's session is given: its sections show what the Stage was told.
          const works: { readonly declared: string; readonly sections: string[] }[] = [];
          const stageThreads = app.get(StageThreads, { strict: false });
          const open = stageThreads.open.bind(stageThreads);
          vi.spyOn(stageThreads, "open").mockImplementation(async (request) => {
            works.push({
              declared: request.declared ?? "by the Context policy",
              sections: request.work.split("\n").filter((line) => line.startsWith("## ")),
            });
            return open(request);
          });

          const base = await git(worktree.path, "rev-parse", "HEAD");
          await api("POST", `/tasks/${taskId}/start`);
          await note(`Task ${taskId} started on Implement, Tests; worktree at ${base}`);

          // Run 1: the user barges in once the Agent is at work.
          const threadId = await threadOfRun(api, taskId, 1);
          const samples: Sample[] = [];
          watcher = watch(api, taskId, samples, () => watching);
          await untilToolActivity(api, threadId, 0);
          await api("POST", `/threads/${threadId}/messages`, { text: BARGE_IN });
          await note("Run 1: barged in while the Agent was at work");
          const bargeInMarks = followDelivery(api, taskId, threadId, () => watching);

          // The Decision it asked for, answered the moment it opens.
          const asked = await until(async () => (await openDecisionsOn(api, taskId))[0], 250);
          const stillRunning = (await latestRun(api, taskId)).outcome === null;
          const option = asked.options.findIndex((each) => each.includes("version"));
          await api("POST", `/decisions/${asked.id}/answer`, {
            kind: "option",
            option: option >= 0 ? option : asked.recommendation.option,
          });
          await note(
            `Decision by ${asked.roleKey ?? "The Office"}: ${asked.question} [${asked.options.join(" | ")}]`,
            `  answered with the run still going: ${stillRunning}`,
          );

          // Run 2: the Stage again after the answer; the user stops it at its first edit.
          const secondThread = await threadOfRun(api, taskId, 2);
          await untilToolActivity(
            api,
            secondThread,
            (await messagesOf(api, secondThread)).length,
            EDITS,
          );
          await api("POST", `/tasks/${taskId}/stop`);
          await note("Run 2: stopped at its first edit");
          const stopped = await untilRunEnds(api, taskId, 2);
          await note(
            `Run 2 (${stopped.session ?? "no session"}) ended: ${JSON.stringify(stopped.outcome)}`,
            `  its work: ${sectionsOf(works, 1)}`,
            `  Task ${(await taskOf(api, taskId)).state}; uncommitted: ${await uncommitted(worktree.path)}`,
          );

          // Resumed fresh: Start fresh on the Thread, then Resume.
          await api("PUT", `/threads/${secondThread}/context-override`, {
            override: "start-fresh",
          });
          await note(`Start fresh chosen: ${contextLine(await threadOf(api, secondThread))}`);
          await api("POST", `/tasks/${taskId}/resume`);

          // Run 3: fresh, in a Thread of its own; the user pauses it at its first tool call, which
          // holds it after the turn.
          const thirdThread = await threadOfRun(api, taskId, 3);
          await untilToolActivity(api, thirdThread, 0);
          await api("POST", `/tasks/${taskId}/pause`);
          await note("Run 3: paused at its first tool call");
          const paused = await untilRunEnds(api, taskId, 3);
          await note(
            `Run 3 (${paused.session ?? "no session"}, ${thirdThread === secondThread ? "same" : "new"} Thread) ended: ${JSON.stringify(paused.outcome)}`,
            `  its work: ${sectionsOf(works, 2)}`,
            `  Task ${(await taskOf(api, taskId)).state}; HEAD moved: ${(await git(worktree.path, "rev-parse", "HEAD")) !== base}; uncommitted: ${await uncommitted(worktree.path)}`,
            `  Resume goes by the Thread's context: ${contextLine(await threadOf(api, thirdThread))}; a Decision open: ${(await openDecisionsOn(api, taskId)).length > 0}`,
          );
          await api("POST", `/tasks/${taskId}/resume`);
          await untilRun(api, taskId, 4);

          const task = await vi.waitFor(
            async () => {
              const current = await taskOf(api, taskId);
              if (!STOPPED_STATES.includes(current.state)) throw new Error(current.state);
              return current;
            },
            { timeout: WALK_MS, interval: 5_000 },
          );
          await app.get(StageInterpreter, { strict: false }).walked(taskId);
          watching = false;
          await watcher;
          const fourth = (await runsOf(api, taskId)).find(({ number }) => number === 4);
          await note(
            `Task ${task.state}; run 4 (${fourth?.session ?? "no session"}), its work: ${sectionsOf(works, 3)}`,
            ...(await bargeInMarks),
          );
          await note(...tokenLines(samples));
          for (const stage of await stagesOf(api, taskId)) {
            await note(...(await stageLines(api, stage)));
          }
          const commits = await git(
            testProject,
            "log",
            "--format=%h %s",
            `${base}..${worktree.branch}`,
          );
          await note("Commits on the Task's branch:", ...commits.split("\n").map((l) => `  ${l}`));

          expect(stopped.outcome).toMatchObject({ status: "failed", interrupted: "stop" });
          expect(paused.session).toBe("fresh");
          expect(paused.outcome).toMatchObject({ status: "failed", interrupted: "pause" });
          expect(fourth?.session).toBe("resume");
          expect(await git(testProject, "rev-parse", "main")).toBe(mainBefore);

          if (PAGE_HOLD_MS > 0) {
            await note(`The Task page: ${url}/tasks/${taskId}, up for ${PAGE_HOLD_MS} ms`);
            await new Promise((resolve) => setTimeout(resolve, PAGE_HOLD_MS));
          }
        } finally {
          watching = false;
          await watcher?.catch(() => undefined);
          await app?.close();
          if (worktree) {
            await run("git", ["worktree", "remove", "--force", worktree.path], {
              cwd: testProject,
            }).catch(() => undefined);
            await run("git", ["branch", "-D", worktree.branch], { cwd: testProject }).catch(
              () => undefined,
            );
          }
          await run(
            "git",
            ["worktree", "remove", "--force", join(officeData, "bases", "notnullsoft-admin")],
            { cwd: testProject },
          ).catch(() => undefined);
          await run("git", ["worktree", "prune"], { cwd: testProject }).catch(() => undefined);
          await rm(folder, { recursive: true, force: true });
        }
      },
      PLANNER_OPENING_MS * 2 + MOVE_MS * 6 + WALK_MS + PAGE_HOLD_MS,
    );
  },
);

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

async function taskOf(api: Api, taskId: string): Promise<Task> {
  return taskSchema.parse(await api("GET", `/tasks/${taskId}`));
}

async function threadOf(api: Api, threadId: string): Promise<Thread> {
  return threadSchema.parse(await api("GET", `/threads/${threadId}`));
}

async function messagesOf(api: Api, threadId: string): Promise<Message[]> {
  return messageListSchema.parse(await api("GET", `/threads/${threadId}/messages`));
}

async function runsOf(api: Api, taskId: string): Promise<StageRun[]> {
  return (await stagesOf(api, taskId))
    .flatMap(({ runs }) => runs)
    .toSorted((one, other) => one.number - other.number);
}

async function latestRun(api: Api, taskId: string): Promise<StageRun> {
  const latest = (await runsOf(api, taskId)).at(-1);
  if (!latest) throw new Error("The Task has no run.");
  return latest;
}

async function untilRun(api: Api, taskId: string, number: number): Promise<StageRun> {
  return until(async () => (await runsOf(api, taskId)).find((each) => each.number === number));
}

/** The run's Stage Thread, which opens once its install has ended. */
async function threadOfRun(api: Api, taskId: string, number: number): Promise<string> {
  return until(
    async () =>
      (await runsOf(api, taskId)).find((each) => each.number === number)?.threadId ?? undefined,
  );
}

async function untilRunEnds(api: Api, taskId: string, number: number): Promise<StageRun> {
  return until(async () =>
    (await runsOf(api, taskId)).find((each) => each.number === number && each.outcome !== null),
  );
}

/** Waits for a call of one of `tools` (any tool when omitted) logged after the first `after` messages. */
async function untilToolActivity(
  api: Api,
  threadId: string,
  after: number,
  tools?: readonly string[],
): Promise<void> {
  await until(async () =>
    (await messagesOf(api, threadId))
      .slice(after)
      .find(
        (message) =>
          message.kind === "tool-activity" && (tools === undefined || tools.includes(message.tool)),
      ),
  );
}

async function uncommitted(worktree: string): Promise<number> {
  const status = await git(worktree, "status", "--porcelain");
  return status === "" ? 0 : status.split("\n").length;
}

function contextLine({ context }: Thread): string {
  return `${context.move} (${context.reason}), context ${context.contextTokens}, override ${context.override ?? "none"}`;
}

function sectionsOf(works: readonly { declared: string; sections: string[] }[], index: number) {
  const work = works[index];
  return work ? `declared ${work.declared}; ${work.sections.join(", ")}` : "not seen";
}

/** The latest Stage Thread's tokens and state, and the running run, every second until `on` turns false. */
async function watch(
  api: Api,
  taskId: string,
  samples: Sample[],
  on: () => boolean,
): Promise<void> {
  while (on()) {
    const runs = await runsOf(api, taskId);
    const threadId = runs.findLast((each) => each.threadId !== null)?.threadId;
    if (threadId) {
      const thread = await threadOf(api, threadId);
      samples.push({
        at: Date.now(),
        threadId,
        tokens: tokensOf(thread.tokens),
        state: thread.state,
        running: runs.find(({ outcome }) => outcome === null)?.number,
      });
    }
    await new Promise((resolve) => setTimeout(resolve, WATCH_INTERVAL_MS));
  }
}

/** Each change of the barge-in's delivery mark, with the run going on then. */
async function followDelivery(
  api: Api,
  taskId: string,
  threadId: string,
  on: () => boolean,
): Promise<string[]> {
  const marks: string[] = [];
  let last: string | undefined;
  while (on() && last !== "delivered" && last !== "not-delivered") {
    const sent = (await messagesOf(api, threadId)).find(
      (message) => message.kind === "user" && message.text === BARGE_IN,
    );
    const mark = sent?.kind === "user" ? sent.delivery : undefined;
    if (mark !== undefined && mark !== last) {
      const latest = await latestRun(api, taskId);
      marks.push(
        `Barge-in ${mark} at ${new Date().toISOString()}, run ${latest.number} ${latest.outcome === null ? "going on" : `ended ${latest.endedAt ?? ""}`}`,
      );
      last = mark;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return marks;
}

/**
 * The tokens as the Task page reads them: for each run, the counts seen while it ran, from the
 * Thread's count before it, and the first count seen after it ended. The last running count beside
 * the one after is the jump of the turn's own usage replacing it.
 */
function tokenLines(samples: readonly Sample[]): string[] {
  const lines = [`Tokens: ${samples.length} samples, a second apart`];
  const numbers = [...new Set(samples.flatMap(({ running }) => running ?? []))];
  for (const number of numbers) {
    const first = samples.findIndex(({ running }) => running === number);
    const last = samples.findLastIndex(({ running }) => running === number);
    const thread = samples[last]!.threadId;
    const seen = samples
      .slice(first, last + 1)
      .filter(({ threadId }) => threadId === thread)
      .map(({ tokens }) => tokens)
      .filter((tokens, i, all) => i === 0 || tokens !== all[i - 1]);
    const earlier = samples[first - 1];
    const before = earlier?.threadId === thread ? earlier.tokens : 0;
    const later = samples[last + 1];
    const after = later?.threadId === thread ? later.tokens : undefined;
    lines.push(
      `  run ${number}: from ${before}, running ${seen.map((tokens) => `+${tokens - before}`).join(" ")}; after it ended ${after === undefined ? "not seen" : `+${after - before} (jump ${after - (seen.at(-1) ?? before)})`}`,
    );
  }
  return lines;
}
