import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  decisionListSchema,
  ideaSchema,
  messageListSchema,
  projectSchema,
  roleSchema,
  taskSchema,
  taskStagesSchema,
  threadListSchema,
  threadSchema,
  type Decision,
  type Message,
  type Project,
  type PublishingMode,
  type Task,
  type TaskStage,
  type Thread,
} from "@the-office/contracts";
import { expect, vi } from "vitest";

/** A call to the service's API, as the web makes it. */
export type ApiCall = (method: string, path: string, body?: unknown) => Promise<Response>;
/** The same call, its JSON answer read, failing on any status but 2xx. */
export type Api = (method: string, path: string, body?: unknown) => Promise<unknown>;

/** The API of a service serving at `url`, for the live checks on the Test Project. */
export function checkApi(url: string): { readonly call: ApiCall; readonly api: Api } {
  const call: ApiCall = async (method, path, body) =>
    fetch(`${url}/api${path}`, {
      method,
      ...(body !== undefined && {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    });
  const api: Api = async (method, path, body) => {
    const response = await call(method, path, body);
    const text = await response.text();
    if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${text}`);
    return text === "" ? undefined : JSON.parse(text);
  };
  return { call, api };
}

/** One line of a check's report for a Thread's message. */
export function messageLine(message: Message): string {
  switch (message.kind) {
    case "user":
    case "person":
    case "handover-note":
      return `${message.kind}: ${message.text.replaceAll("\n", " / ")}`;
    case "tool-activity":
      return `tool ${message.tool}: ${message.summary}`;
    case "context":
      return `context ${message.move} (${message.reason}), context ${message.contextTokens}, brief ${message.briefTokens}`;
    case "failure":
      return `failure: ${message.reason}`;
    case "held":
      return `held (${message.heldBy}): ${message.text}`;
    case "decision": {
      const { question, options, recommendation } = message.decision;
      return `decision: ${question} [${options.join(" | ")}], recommends ${recommendation.option + 1}: ${recommendation.reason}`;
    }
    case "decision-answer":
      return `decision-answer: ${JSON.stringify(message.answer)}`;
    case "proposal":
      return `proposal ${message.proposal.change.kind} (${message.proposal.status.kind}): ${JSON.stringify(message.proposal.change)}`;
    case "link-card":
      return `link-card to ${message.to.roleKey}${message.to.letGo ? " (let go)" : ""}: ${message.note.replaceAll("\n", " / ")}`;
    case "idea":
      return `idea card: ${message.ideaId}`;
    case "office-status":
      return "office-status card";
    case "refusal":
      return `refusal ${message.tool}: ${message.reason}`;
  }
}

const run = promisify(execFile);

/** A git command's output in `folder`, trimmed. */
export async function git(folder: string, ...args: string[]): Promise<string> {
  return (await run("git", args, { cwd: folder })).stdout.trim();
}

/** All four kinds of a Thread's or a run's tokens, summed. */
/** A path as git and Windows both write it, to compare the two. */
export function comparable(path: string): string {
  return path.replaceAll("\\", "/").toLowerCase();
}

/** One part of a check's clean-up: what fails is said, and the rest goes on. */
export async function quietly(work: () => Promise<unknown>): Promise<void> {
  await work().catch((error: unknown) => {
    console.warn(`Clean-up: ${String(error)}`);
  });
}

export function tokensOf(tokens: Readonly<Record<string, number>>): number {
  return Object.values(tokens).reduce((sum, part) => sum + part, 0);
}

/** Hires each Role from its preset on Haiku at low effort, the cheapest that proves a check. */
export async function hireOnHaiku(
  api: Api,
  hires: readonly (readonly [roleKey: string, name: string])[],
): Promise<void> {
  for (const [roleKey, name] of hires) {
    const hired = roleSchema.parse(await api("POST", "/roles", { roleKey, name }));
    await api("PUT", `/roles/${roleKey}/card`, {
      ...hired.card,
      model: "claude-haiku-5-5",
      effort: "low",
      skills: [],
    });
  }
}

/** Where the Test Project's Tasks branch from and how they publish; `main` and push + PR unless said. */
export interface TestProjectPublishing {
  readonly baseBranch?: string;
  readonly publishingMode?: PublishingMode;
}

/** The Test Project as a Project, with its own commands, on Quick fix. */
export async function addTestProject(
  api: Api,
  path: string,
  { baseBranch = "main", publishingMode = "push-and-pull-request" }: TestProjectPublishing = {},
): Promise<Project> {
  return projectSchema.parse(
    await api("POST", "/projects", {
      name: "notnullsoft-admin",
      path,
      baseBranch,
      mark: { label: "NA", colour: "teal" },
      commands: {
        install: "npm install",
        build: "npm run build",
        lint: "npm run lint",
        test: "npm test",
      },
      installInputs: ["package-lock.json"],
      publishingMode,
      defaultPipeline: "quick-fix",
    }),
  );
}

export async function untilThreadWaits(
  api: Api,
  threadId: string,
  timeoutMs: number,
): Promise<void> {
  await vi.waitFor(
    async () => {
      const current = threadSchema.parse(await api("GET", `/threads/${threadId}`));
      if (current.state !== "waiting") throw new Error("Still answering.");
    },
    { timeout: timeoutMs, interval: 1_000 },
  );
}

/** The Task a check plans: its Idea, then the plan and Definition of Done the user writes. */
export interface CheckTask {
  readonly title: string;
  readonly notes: string;
  readonly plan: string;
  readonly definitionOfDone: readonly string[];
}

/**
 * Plans `task` on Quick fix as tasks 12 to 15's checks do: the Planner's opening, its Decisions
 * answered with their recommendations, then the user writes the parts and marks the Task Ready.
 */
export async function planOnQuickFix(
  api: Api,
  project: Project,
  task: CheckTask,
  openingMs: number,
): Promise<{ readonly taskId: string; readonly tokens: Thread["tokens"] }> {
  const idea = ideaSchema.parse(
    await api("POST", "/ideas", { title: task.title, notes: task.notes, projectId: project.id }),
  );
  const taskId = taskSchema.parse(
    await api("POST", `/ideas/${idea.id}/shape`, { projectId: project.id }),
  ).id;
  await api("POST", `/tasks/${taskId}/planning`);
  const planningThread = threadListSchema.parse(await api("GET", `/tasks/${taskId}/threads`))[0];
  if (!planningThread) throw new Error("Planning opened no Thread.");
  await untilThreadWaits(api, planningThread.id, openingMs);
  for (const asked of await openDecisionsOn(api, taskId)) {
    await api("POST", `/decisions/${asked.id}/answer`, {
      kind: "option",
      option: asked.recommendation.option,
    });
  }
  await untilThreadWaits(api, planningThread.id, openingMs);
  await api("PUT", `/tasks/${taskId}/plan`, { plan: task.plan });
  await api("PUT", `/tasks/${taskId}/definition-of-done`, {
    definitionOfDone: task.definitionOfDone,
  });
  await api("PUT", `/tasks/${taskId}/pipeline`, { pipelineId: "quick-fix" });
  expect(taskSchema.parse(await api("POST", `/tasks/${taskId}/ready`)).state).toBe("ready");
  const { tokens } = threadSchema.parse(await api("GET", `/threads/${planningThread.id}`));
  return { taskId, tokens };
}

const STOPPED_STATES: readonly Task["state"][] = ["done", "waiting-on-you", "dropped", "paused"];

/** Waits until the Task leaves In progress: Done, Waiting on you, or stopped otherwise. */
export async function untilWalkStops(api: Api, taskId: string, timeoutMs: number): Promise<Task> {
  return vi.waitFor(
    async () => {
      const task = taskSchema.parse(await api("GET", `/tasks/${taskId}`));
      if (!STOPPED_STATES.includes(task.state)) throw new Error(`Still ${task.state}.`);
      return task;
    },
    { timeout: timeoutMs, interval: 5_000 },
  );
}

export async function openDecisionsOn(api: Api, taskId: string): Promise<Decision[]> {
  const open = decisionListSchema.parse(await api("GET", "/decisions/open"));
  return open.filter((decision) => decision.taskId === taskId);
}

export async function stagesOf(api: Api, taskId: string): Promise<TaskStage[]> {
  const { stages } = taskStagesSchema.parse(await api("GET", `/tasks/${taskId}/stages`));
  if (!stages) throw new Error(`Task ${taskId} has no Stages of its own.`);
  return stages;
}

/** A Stage's report: its state and tokens, then each run with its session, result and Thread. */
export async function stageLines(
  api: Api,
  { stage, state, tokens, runs }: TaskStage,
): Promise<string[]> {
  const lines = [`## ${stage.name} (${stage.kind}): ${state}, ${tokens} tokens`];
  for (const stageRun of runs) {
    const { outcome } = stageRun;
    const seconds =
      stageRun.endedAt === null
        ? "running"
        : `${Math.round((Date.parse(stageRun.endedAt) - Date.parse(stageRun.startedAt)) / 1000)} s`;
    lines.push(
      `  run ${stageRun.number}: ${seconds}, session ${stageRun.session ?? "none"}, tokens ${tokensOf(stageRun.tokens)} ${JSON.stringify(stageRun.tokens)}`,
      ...(stageRun.carriedFailure
        ? [
            `    carried failure from ${stageRun.carriedFailure.stageKey}, round ${stageRun.carriedFailure.round}`,
          ]
        : []),
      ...stageRun.commandRuns.map(
        ({ purpose, commandLine, outcome: ran, durationMs }) =>
          `    ${purpose} \`${commandLine}\`: ${ran} in ${Math.round(durationMs / 1000)} s`,
      ),
      `    outcome: ${outcome === null ? "none" : JSON.stringify(outcome)}`,
    );
    if (stageRun.threadId !== null) {
      const messages = messageListSchema.parse(
        await api("GET", `/threads/${stageRun.threadId}/messages`),
      );
      lines.push(...messages.map((message) => `    | ${messageLine(message)}`));
    }
  }
  return lines;
}

/** Leaves the Test Project as it was: the check's worktrees, the Task's branch and the base branch removed. */
export async function cleanUpTestProject(
  repositoryPath: string,
  left: { readonly base: string; readonly taskId: string | undefined; readonly officeData: string },
): Promise<void> {
  const officeWorktrees = comparable(left.officeData);
  await quietly(async () => {
    for (const line of (await git(repositoryPath, "worktree", "list", "--porcelain")).split("\n")) {
      const path = line.startsWith("worktree ") ? line.slice("worktree ".length) : "";
      if (path !== "" && comparable(path).startsWith(officeWorktrees))
        await git(repositoryPath, "worktree", "remove", "--force", path);
    }
  });
  await quietly(() => git(repositoryPath, "worktree", "prune"));
  if (left.taskId !== undefined) {
    const taskId = left.taskId;
    await quietly(() => git(repositoryPath, "branch", "-D", `office/${taskId}`));
  }
  await quietly(() => git(repositoryPath, "branch", "-D", left.base));
}
