import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { INestApplication } from "@nestjs/common";
import { context, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { BatchSpanProcessor, TracerProvider } from "@opentelemetry/sdk-trace";
import {
  ideaSchema,
  taskSchema,
  threadListSchema,
  threadSchema,
  type Decision,
  type Task,
  type TaskStage,
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
  untilThreadWaits,
  type Api,
} from "../../../../test/live-check.js";
import { startTestApplication } from "../../../../test/test-application.js";
import { testDatabaseUrl } from "../../../../test/test-database.js";
import { AppModule } from "../../../app.module.js";
import { builtInPipelines } from "../domain/built-in-pipelines.js";
import { makeTaskStages } from "../domain/task-stages.js";
import { TaskStagesRepository } from "../ports/task-stages-repository.js";
import { StageInterpreter } from "./stage-interpreter.js";

/**
 * Task 12's check on the Test Project (docs/tasks/12-stage-interpreter.md): a small real change,
 * planned as in task 11's check, is started on Quick fix without its Publish Stage (Publish is task
 * 14), seeded into the Task as its own Stages; the Developer works it on Haiku and the Tests Stage
 * runs the Project's tests. The Task's branch and worktree are discarded after. Live, so it runs
 * only when asked: OFFICE_ENGINE_TESTS=live and OFFICE_TEST_PROJECT=<the Test Project's folder>,
 * with OFFICE_CHECK_REPORT=<a file> to keep what it saw. The trace is looked up in Grafana unless
 * OFFICE_CHECK_GRAFANA=off (a machine without otel-lgtm); OFFICE_CHECK_PAGE_HOLD_MS keeps the
 * service up that long after the run, its address in the report, to look at the Task page. It
 * hires the Planner and the Developer from their presets, so it runs alone.
 */
const MODE = process.env["OFFICE_ENGINE_TESTS"];
const TEST_PROJECT = process.env["OFFICE_TEST_PROJECT"];
const REPORT = process.env["OFFICE_CHECK_REPORT"];
const WITH_GRAFANA = process.env["OFFICE_CHECK_GRAFANA"] !== "off";
const PAGE_HOLD_MS = Number(process.env["OFFICE_CHECK_PAGE_HOLD_MS"] ?? "0");
const OTLP_ENDPOINT = process.env["OTEL_EXPORTER_OTLP_ENDPOINT"] ?? "http://127.0.0.1:4318";
const GRAFANA = `http://127.0.0.1:${process.env["GRAFANA_PORT"] ?? "3300"}`;
const WEB_APP = fileURLToPath(new URL("../../../../../web", import.meta.url));
const PLANNER_OPENING_MS = 240_000;
const WALK_MS = 60 * 60_000;
/** A budget Decision is answered by raising it, this many times at most; any other one ends the check. */
const MOST_RAISES = 2;
const STOPPED_STATES: readonly Task["state"][] = ["done", "waiting-on-you", "dropped", "paused"];
const run = promisify(execFile);

const PLAN = [
  "In apps/admin-panel/server, make GET /api/health answer { ok: true, version }, the version read from the server package's own package.json.",
  "Cover it with a test beside the server's existing tests, and update the README's row for GET /api/health.",
].join("\n\n");
const DEFINITION_OF_DONE = [
  "GET /api/health answers ok: true and a version equal to the server package.json's version.",
  "A server test checks the version in the health answer, and npm test passes.",
  "The README's row for GET /api/health names the version.",
];

describe.runIf(MODE === "live" && TEST_PROJECT !== undefined)(
  "Task 12's check on the Test Project",
  () => {
    it(
      "walks Quick fix without Publish: the Developer implements on Haiku, the Tests Stage runs the Project's tests",
      async () => {
        const testProject = TEST_PROJECT ?? "";
        const folder = await mkdtemp(join(tmpdir(), "office-stages-check-"));
        const officeData = join(folder, "office-data");
        const report: string[] = [];
        const note = async (...lines: string[]): Promise<void> => {
          report.push(...lines);
          // For the task's Progress log: vitest keeps a passing test's console to itself.
          if (REPORT) await writeFile(REPORT, `${report.join("\n")}\n`);
        };
        // The service's tracer is the global one; children find their parent through the context.
        const tracing = new TracerProvider({
          spanProcessors: [
            new BatchSpanProcessor({
              exporter: new OTLPTraceExporter({ url: `${OTLP_ENDPOINT}/v1/traces` }),
            }),
          ],
        });
        trace.setGlobalTracerProvider(tracing);
        context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
        const mainBefore = await git(testProject, "rev-parse", "main");
        let app: INestApplication | undefined;
        let worktree: { path: string; branch: string } | undefined;
        try {
          let url: string;
          ({ app, url } = await startTestApplication({
            imports: [
              AppModule.register(
                { port: 0, databaseUrl: testDatabaseUrl(), officeDataDirectory: officeData },
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

          // Task 11's Task, planned again: the Planner's opening, then the user writes the parts.
          const idea = ideaSchema.parse(
            await api("POST", "/ideas", {
              title: "Report the build version on the health check",
              notes:
                "So we can tell which build is deployed. The version could come from package.json or from an environment variable set at deploy; I haven't chosen.",
              projectId: project.id,
            }),
          );
          const shaped = taskSchema.parse(
            await api("POST", `/ideas/${idea.id}/shape`, { projectId: project.id }),
          );
          const taskId = shaped.id;
          await api("POST", `/tasks/${taskId}/planning`);
          worktree = {
            path: join(officeData, "worktrees", project.id, taskId),
            branch: `office/${taskId}`,
          };
          const base = await git(worktree.path, "rev-parse", "HEAD");
          const planningThread = threadListSchema.parse(
            await api("GET", `/tasks/${taskId}/threads`),
          )[0];
          if (!planningThread) throw new Error("Planning opened no Thread.");
          await untilThreadWaits(api, planningThread.id, PLANNER_OPENING_MS);
          // The opening may already ask where the version comes from: the Plan's answer.
          const asked = (await openDecisionsOn(api, taskId))[0];
          if (asked) {
            const chosen = asked.options.findIndex((option) => option.includes("package.json"));
            const option = chosen >= 0 ? chosen : asked.recommendation.option;
            await note(`Planning asked: ${asked.question}; answered: ${asked.options[option]}`);
            await api("POST", `/decisions/${asked.id}/answer`, { kind: "option", option });
            await untilThreadWaits(api, planningThread.id, PLANNER_OPENING_MS);
          }
          await api("PUT", `/tasks/${taskId}/plan`, { plan: PLAN });
          await api("PUT", `/tasks/${taskId}/definition-of-done`, {
            definitionOfDone: DEFINITION_OF_DONE,
          });
          await api("PUT", `/tasks/${taskId}/pipeline`, { pipelineId: "quick-fix" });
          expect(taskSchema.parse(await api("POST", `/tasks/${taskId}/ready`)).state).toBe("ready");
          const planned = threadSchema.parse(await api("GET", `/threads/${planningThread.id}`));
          await note(
            `Task ${taskId} "${shaped.title}" Ready on quick-fix; worktree ${worktree.path} on ${worktree.branch} at ${base}`,
            `Planning Thread tokens ${tokensOf(planned.tokens)} ${JSON.stringify(planned.tokens)}`,
          );

          // Quick fix without Publish, seeded as the Task's own Stages; the walk keeps them.
          const quickFix = builtInPipelines.find(({ id }) => id === "quick-fix");
          if (!quickFix) throw new Error("There is no built-in Quick fix.");
          const stages = quickFix.stages.filter((stage) => stage.key !== "publish");
          expect(
            stages.some((stage) => stage.kind === "script" && stage.command === "publish"),
          ).toBe(false);
          const repository = app.get(TaskStagesRepository, { strict: false });
          const { taskStages } = makeTaskStages(taskId, { ...quickFix, stages }, new Date());
          await repository.save(taskStages);
          await note(`Seeded Stages: ${stages.map(({ name }) => name).join(", ")}`);

          await api("POST", `/tasks/${taskId}/start`);
          const startedAt = Date.now();
          let task = await untilWalkStops(api, taskId);
          for (let raises = 0; task.state === "waiting-on-you"; raises++) {
            // The walk opens the Decision before it marks the Task Waiting on you.
            const open = await openDecisionsOn(api, taskId);
            await note(
              ...open.map(
                ({ question, options }) => `Waiting on you: ${question} [${options.join(" | ")}]`,
              ),
            );
            const budgetReached = (await stagesOf(api, taskId)).some(({ runs }) => {
              const outcome = runs.at(-1)?.outcome;
              return outcome?.status === "failed" && outcome.budgetReached !== null;
            });
            const raise = budgetReached && open.length === 1 ? open[0] : undefined;
            if (!raise || raises >= MOST_RAISES) break;
            await note(`Answered: ${raise.options[0]}`);
            await api("POST", `/decisions/${raise.id}/answer`, { kind: "option", option: 0 });
            task = await untilWalkStops(api, taskId);
          }
          await app.get(StageInterpreter, { strict: false }).walked(taskId);
          await note(
            `Task ${task.state} after ${Math.round((Date.now() - startedAt) / 60_000)} min`,
          );

          // Each Stage's tokens, sessions and results, as the Task page reads them.
          const ownStages = await stagesOf(api, taskId);
          for (const stage of ownStages) await note(...(await stageLines(api, stage)));
          const total = ownStages.reduce((sum, { tokens }) => sum + tokens, 0);
          await note(`Stage tokens in all: ${total}`);

          // What git holds: the Stages' commits on the Task's branch, the Project's main untouched.
          const commits = await git(
            testProject,
            "log",
            "--format=%h %s",
            `${base}..${worktree.branch}`,
          );
          await note("Commits on the Task's branch:", ...commits.split("\n").map((l) => `  ${l}`));
          const testOutput = await readdir(join(officeData, "test-output")).catch(() => []);
          await note(`Test output folders kept: ${testOutput.length}`);
          expect(await git(testProject, "rev-parse", "main")).toBe(mainBefore);
          expect(await git(testProject, "status", "--porcelain")).toBe("");

          // One trace per Task: the walk's root, a span per Stage run, the engine calls in them.
          const kept = await repository.find(taskId);
          if (!kept?.trace) throw new Error("The Task's trace wasn't kept.");
          let traceProblems: string[] = [];
          if (WITH_GRAFANA) {
            await tracing.forceFlush();
            const { traceId, spanId: rootSpanId } = kept.trace;
            const runCount = ownStages.flatMap(({ runs }) => runs).length;
            const spans = await traceSpans(
              traceId,
              (read) => problemsOfTrace(read, rootSpanId, runCount).length === 0,
            );
            await note(...traceLines(traceId, spans));
            traceProblems = problemsOfTrace(spans, rootSpanId, runCount);
          } else {
            await note(`Trace ${kept.trace.traceId}: not looked up (OFFICE_CHECK_GRAFANA=off)`);
          }
          expect(traceProblems).toEqual([]);

          // How the walk ended is the Agent's doing; that it ended as the walk promises is the check.
          const openAtEnd = await openDecisionsOn(api, taskId);
          expect(endProblems(task, ownStages, openAtEnd)).toEqual([]);

          if (PAGE_HOLD_MS > 0) {
            await note(`The Task page: ${url}/tasks/${taskId}, up for ${PAGE_HOLD_MS} ms`);
            await new Promise((resolve) => setTimeout(resolve, PAGE_HOLD_MS));
          }
        } finally {
          const closing = Date.now();
          await app?.close();
          await note(`The service closed in ${Math.round((Date.now() - closing) / 1000)} s`);
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
          // Without otel-lgtm the last export fails; the check has looked at what it needs by then.
          await tracing.shutdown().catch(() => undefined);
          trace.disable();
          context.disable();
          await rm(folder, { recursive: true, force: true });
        }
      },
      PLANNER_OPENING_MS + WALK_MS + PAGE_HOLD_MS + 120_000,
    );
  },
);

/** Waits until the Task leaves In progress: Done, Waiting on you, or stopped otherwise. */
async function untilWalkStops(api: Api, taskId: string): Promise<Task> {
  return vi.waitFor(
    async () => {
      const task = taskSchema.parse(await api("GET", `/tasks/${taskId}`));
      if (!STOPPED_STATES.includes(task.state)) throw new Error(`Still ${task.state}.`);
      return task;
    },
    { timeout: WALK_MS, interval: 5_000 },
  );
}

/**
 * What the walk's end lacks: every run ended; Done with every Stage done, or Waiting on you with a
 * Decision open. Which of the two depends on the Agent's work.
 */
function endProblems(
  task: Task,
  stages: readonly TaskStage[],
  openDecisions: readonly Decision[],
): string[] {
  const running = stages.flatMap(({ runs }) => runs).filter(({ outcome }) => outcome === null);
  return [
    running.length === 0 ? undefined : `${running.length} Stage runs never ended.`,
    task.state !== "done" || stages.every(({ state }) => state === "done")
      ? undefined
      : "The Task is Done with a Stage not done.",
    task.state !== "waiting-on-you" || openDecisions.length > 0
      ? undefined
      : "The Task waits on the user with no Decision open.",
    ["done", "waiting-on-you"].includes(task.state)
      ? undefined
      : `The walk stopped with the Task ${task.state}.`,
  ].filter((problem) => problem !== undefined);
}

interface TraceSpan {
  readonly spanId: string;
  readonly parentSpanId: string;
  readonly name: string;
}

/**
 * The trace's spans, from Tempo through Grafana, read until `complete` holds of them: Tempo takes
 * in a trace's batches one by one. After a minute, whatever Tempo has, for the check to judge.
 */
async function traceSpans(
  traceId: string,
  complete: (spans: readonly TraceSpan[]) => boolean,
): Promise<TraceSpan[]> {
  let read: TraceSpan[] = [];
  try {
    await vi.waitFor(
      async () => {
        read = await tempoSpans(traceId);
        if (!complete(read)) throw new Error("Tempo doesn't have the whole trace yet.");
      },
      { timeout: 60_000, interval: 2_000 },
    );
  } catch {
    // Judged by the caller as it stands.
  }
  return read;
}

async function tempoSpans(traceId: string): Promise<TraceSpan[]> {
  const response = await fetch(
    `${GRAFANA}/api/datasources/proxy/uid/tempo/api/v2/traces/${traceId}`,
    { headers: { Accept: "application/json" } },
  );
  if (!response.ok) return [];
  const body = (await response.json()) as TempoTrace;
  return (body.trace?.resourceSpans ?? []).flatMap(({ scopeSpans }) =>
    scopeSpans.flatMap(({ spans }) =>
      spans.map(({ spanId, parentSpanId, name }) => ({
        spanId: idHex(spanId),
        parentSpanId: parentSpanId ? idHex(parentSpanId) : "",
        name,
      })),
    ),
  );
}

interface TempoTrace {
  readonly trace?: {
    readonly resourceSpans: readonly {
      readonly scopeSpans: readonly {
        readonly spans: readonly {
          readonly spanId: string;
          readonly parentSpanId?: string;
          readonly name: string;
        }[];
      }[];
    }[];
  };
}

/** Tempo's JSON gives span ids in base64; the SDK, and so `task_stages.trace`, in hex. */
function idHex(id: string): string {
  return /^[0-9a-f]{16}$/.test(id) ? id : Buffer.from(id, "base64").toString("hex");
}

/**
 * What the trace lacks: the kept root as its first walk span, every later walk (one per answer)
 * under it, a span per Stage run under a walk, and the engine calls under the Stage runs.
 */
function problemsOfTrace(
  spans: readonly TraceSpan[],
  rootSpanId: string,
  runCount: number,
): string[] {
  const walks = spans.filter(({ name }) => name === "walk");
  const walkIds = new Set(walks.map(({ spanId }) => spanId));
  const stageSpans = spans.filter(({ name }) => name === "stage");
  const stageIds = new Set(stageSpans.map(({ spanId }) => spanId));
  const calls = spans.filter(({ name }) => name === "engine call");
  return [
    walkIds.has(rootSpanId) ? undefined : "No walk span is the kept root.",
    walks.every(({ spanId, parentSpanId }) => spanId === rootSpanId || parentSpanId === rootSpanId)
      ? undefined
      : "A later walk span isn't a child of the root.",
    stageSpans.length === runCount
      ? undefined
      : `${stageSpans.length} stage spans for ${runCount} Stage runs.`,
    stageSpans.every(({ parentSpanId }) => walkIds.has(parentSpanId))
      ? undefined
      : "A stage span isn't a child of a walk.",
    calls.length > 0 ? undefined : "No engine call span.",
    calls.every(({ parentSpanId }) => stageIds.has(parentSpanId))
      ? undefined
      : "An engine call span isn't a child of a stage span.",
  ].filter((problem) => problem !== undefined);
}

function traceLines(traceId: string, spans: readonly TraceSpan[]): string[] {
  const count = (name: string) => spans.filter((span) => span.name === name).length;
  const perStage = spans
    .filter(({ name }) => name === "stage")
    .map(
      (stage) =>
        spans.filter(
          ({ name, parentSpanId }) => name === "engine call" && parentSpanId === stage.spanId,
        ).length,
    );
  return [
    `Trace ${traceId}: ${spans.length} spans, walk ${count("walk")}, stage ${count("stage")}, engine call ${count("engine call")} (per Stage run: ${perStage.join(", ")})`,
  ];
}
