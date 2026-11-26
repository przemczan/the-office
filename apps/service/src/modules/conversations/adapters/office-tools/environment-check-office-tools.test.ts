import { afterEach, describe, expect, it, vi } from "vitest";
import { anOfficeToolCall } from "../../../engine/index.fixtures.js";
import { OfficeToolRegistry } from "../../../engine/index.js";
import {
  EnvironmentChecks,
  ProjectRefused,
  type EnvironmentCheck,
  type ProjectService,
} from "../../../projects/index.js";
import type { HeldCallOutcome, HeldCallRequest, HeldCalls } from "../../application/held-calls.js";
import { SessionStops } from "../../application/session-stops.js";
import type { WorkRecords } from "../../application/work-records.js";
import { RUN_ENVIRONMENT_CHECK_TOOL } from "../../domain/session-instructions.js";
import { aThread } from "../../domain/thread.fixtures.js";
import type { Thread } from "../../domain/thread.js";
import type { ThreadRepository } from "../../ports/thread-repository.js";
import {
  ENVIRONMENT_CHECK_TOOL_TIMEOUT_MS,
  EnvironmentCheckOfficeTools,
} from "./environment-check-office-tools.js";
import { RUN_EVERY_CALL } from "../../../engine/index.fixtures.js";

const SESSION = "session-1";
const TASK = "task-1";
const PROJECT = "project-1";
const TASK_THREAD = aThread({ home: { kind: "task", taskId: TASK } });
/** A Task of another Project, which the stubbed Work records give as of OTHER_PROJECT. */
const OTHER_TASK = "task-2";
const OTHER_PROJECT = "project-2";

type CheckCall = Parameters<EnvironmentChecks["check"]>;

function aCheck(fields: Partial<EnvironmentCheck> = {}): EnvironmentCheck {
  return {
    projectId: PROJECT,
    environment: {} as EnvironmentCheck["environment"],
    state: "passed",
    checks: [
      {
        step: "worktree",
        state: "passed",
        base: { commit: "0123456789abcdef", fetchedFrom: "origin/main" },
      },
      {
        step: "install",
        state: "passed",
        commandLine: "npm ci",
        run: {
          commandLine: "npm ci",
          outcome: "passed",
          exitCode: 0,
          durationMs: 4000,
          output: "added 1 package\n",
        },
      },
    ] as unknown as EnvironmentCheck["checks"],
    startedAt: new Date(0),
    finishedAt: new Date(1),
    ...fields,
  };
}

interface Setup {
  readonly thread?: Thread | undefined;
  readonly outcome?: HeldCallOutcome;
  readonly check?: (...args: CheckCall) => Promise<EnvironmentCheck>;
}

function setup({
  thread = aThread(),
  outcome = { kind: "proceed", roleKey: "devops" },
  check = () => Promise.resolve(aCheck()),
}: Setup = {}) {
  const holds: HeldCallRequest[] = [];
  const checkCalls: CheckCall[] = [];
  const stops = new SessionStops();
  const registry = new OfficeToolRegistry();
  new EnvironmentCheckOfficeTools(
    registry,
    {
      find: (id: string) =>
        Promise.resolve(id === "gone" ? undefined : { id, name: "Admin", baseBranch: "main" }),
    } as unknown as ProjectService,
    {
      check: (...args: CheckCall) => {
        checkCalls.push(args);
        return check(...args);
      },
    } as unknown as EnvironmentChecks,
    {
      hold: (request: HeldCallRequest) => {
        holds.push(request);
        return Promise.resolve(outcome);
      },
    } as unknown as HeldCalls,
    {
      findBySession: (id: string) => Promise.resolve(id === SESSION ? thread : undefined),
    } as unknown as ThreadRepository,
    {
      taskSubjects: (ids: readonly string[]) =>
        Promise.resolve(
          new Map(
            ids
              .filter((id) => id !== "unknown")
              .map((id) => [id, { projectId: id === OTHER_TASK ? OTHER_PROJECT : PROJECT }]),
          ),
        ),
    } as unknown as WorkRecords,
    stops,
  ).onModuleInit();
  const [tool] = registry.named([RUN_ENVIRONMENT_CHECK_TOOL], RUN_EVERY_CALL);
  if (!tool) throw new Error("run_environment_check is not registered.");
  const run = (input: { project?: string; task?: string }, session = SESSION) =>
    tool.run({ why: "To see it works.", ...input }, anOfficeToolCall(session));
  return { run, holds, checkCalls, stops };
}

describe("the run_environment_check tool", () => {
  afterEach(() => vi.useRealTimers());

  it("checks the base branch of the given Project outside a Task, held behind Run installs", async () => {
    const { run, holds, checkCalls } = setup();

    const result = await run({ project: PROJECT });

    expect(result.isError).toBe(false);
    expect(holds).toHaveLength(1);
    expect(holds[0]?.switchKey).toBe("runInstalls");
    expect(holds[0]?.call).toContain("base branch main");
    expect(checkCalls[0]?.[0]).toBe(PROJECT);
    expect(checkCalls[0]?.[1]).not.toHaveProperty("taskId");
  });

  it("checks the Task's branch in a Thread on a Task, of the Task's Project", async () => {
    const { run, checkCalls, holds } = setup({ thread: TASK_THREAD });

    const result = await run({});

    expect(result.isError).toBe(false);
    expect(checkCalls[0]?.[0]).toBe(PROJECT);
    expect(checkCalls[0]?.[1]).toMatchObject({ taskId: TASK });
    expect(holds[0]?.call).toContain("Task's branch");
  });

  it("checks a given Task's branch from a Thread on no Task, of the Task's Project", async () => {
    const { run, checkCalls, holds } = setup();

    const result = await run({ task: OTHER_TASK });

    expect(result.isError).toBe(false);
    expect(checkCalls[0]?.[0]).toBe(OTHER_PROJECT);
    expect(checkCalls[0]?.[1]).toMatchObject({ taskId: OTHER_TASK });
    expect(holds[0]?.call).toContain(`branch of the Task ${OTHER_TASK}`);
    expect(holds[0]?.context).toContain("while the Project's Run environment is On");
  });

  it("checks another Task's branch from a Thread on a Task when the call names it", async () => {
    const { run, checkCalls } = setup({ thread: TASK_THREAD });

    const result = await run({ task: OTHER_TASK, project: OTHER_PROJECT });

    expect(result.isError).toBe(false);
    expect(checkCalls[0]?.[0]).toBe(OTHER_PROJECT);
    expect(checkCalls[0]?.[1]).toMatchObject({ taskId: OTHER_TASK });
  });

  it("refuses a given Task with another Project, and a Task The Office doesn't have", async () => {
    const { run, checkCalls } = setup();

    const mismatched = await run({ task: OTHER_TASK, project: PROJECT });
    expect(mismatched.isError).toBe(true);
    expect(mismatched.text).toContain(`is of the Project ${OTHER_PROJECT}`);
    expect((await run({ task: "unknown" })).text).toContain('no Task "unknown"');
    expect(checkCalls).toEqual([]);
  });

  it("refuses another Project on a Task, and no or an unknown Project outside one", async () => {
    const onTask = setup({ thread: TASK_THREAD });
    expect((await onTask.run({ project: "other" })).isError).toBe(true);
    expect(onTask.checkCalls).toEqual([]);

    const outside = setup();
    const none = await outside.run({});
    expect(none.isError).toBe(true);
    expect(none.text).toContain("Give the Project");
    expect((await outside.run({ project: "gone" })).text).toContain('no Project "gone"');
    expect((await outside.run({}, "other-session")).text).toContain("doesn't know");
  });

  it("answers each step with its state, command line, exit code and the tail of its output", async () => {
    const output = Array.from({ length: 60 }, (_, index) => `line ${index + 1}`).join("\n");
    const check = aCheck({
      state: "failed",
      checks: [
        {
          step: "worktree",
          state: "passed",
          base: { commit: "0123456789abcdef", fetchedFrom: "origin/main" },
        },
        {
          step: "command",
          key: "test",
          name: "Test",
          state: "failed",
          commandLine: "npm test",
          run: {
            commandLine: "npm test",
            outcome: "failed",
            exitCode: 1,
            durationMs: 2000,
            output,
          },
        },
      ] as unknown as EnvironmentCheck["checks"],
    });
    const { run } = setup({ check: () => Promise.resolve(check) });

    const result = await run({ project: PROJECT });

    expect(result.isError).toBe(true);
    expect(result.text).toContain(
      "Worktree: passed (commit 0123456789ab, fetched from origin/main)",
    );
    expect(result.text).toContain("Command test (Test): failed");
    expect(result.text).toContain("Command line: npm test");
    expect(result.text).toContain("exit code 1");
    expect(result.text).toContain("line 60");
    expect(result.text).toContain("line 21");
    expect(result.text).not.toMatch(/line 20\b/);
    expect(result.text).toContain("Failed: test.");
  });

  it("answers what the Run installs switch says: held waits, refused is an error, nothing runs", async () => {
    const held = setup({ outcome: { kind: "held", waitingOn: "the user" } });
    const heldResult = await held.run({ project: PROJECT });
    expect(heldResult.isError).toBe(false);
    expect(heldResult.text).toContain("the user");
    expect(held.checkCalls).toEqual([]);

    const never = setup({ outcome: { kind: "refused", reason: "Run installs is Never." } });
    expect(await never.run({ project: PROJECT })).toEqual({
      text: "Run installs is Never.",
      isError: true,
    });
    expect(never.checkCalls).toEqual([]);
  });

  it("answers a Project's refusal as an error", async () => {
    const { run } = setup({ check: () => Promise.reject(new ProjectRefused(["Not now."])) });

    const result = await run({ project: PROJECT });

    expect(result.isError).toBe(true);
    expect(result.text).toContain("Not now.");
  });

  it("stops the check and says it timed out once the timeout passes", async () => {
    vi.useFakeTimers();
    const { run } = setup({
      check: (_id, options) =>
        new Promise((resolve) => {
          options?.signal?.addEventListener("abort", () => resolve(aCheck({ state: "stopped" })));
        }),
    });

    const pending = run({ project: PROJECT });
    await vi.advanceTimersByTimeAsync(ENVIRONMENT_CHECK_TOOL_TIMEOUT_MS + 1);
    const result = await pending;

    expect(result.isError).toBe(true);
    expect(result.text).toContain("Timed out");
  });

  it("stops the check's waiting when its session stops", async () => {
    let received: AbortSignal | undefined;
    const { run, stops } = setup({
      check: (_id, options) =>
        new Promise((resolve) => {
          received = options?.signal;
          received?.addEventListener("abort", () => resolve(aCheck({ state: "stopped" })));
        }),
    });

    const pending = run({ project: PROJECT });
    await vi.waitFor(() => expect(received).toBeDefined());
    expect(received?.aborted).toBe(false);
    stops.stopped(SESSION);
    const result = await pending;

    expect(received?.aborted).toBe(true);
    expect(result.isError).toBe(true);
    expect(result.text).toContain("Stopped before it finished.");
    expect(result.text).not.toContain("Timed out");
  });
});
