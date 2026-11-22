import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  decisionListSchema,
  engineIdSchema,
  engineSettingsSchema,
  ideaSchema,
  messageListSchema,
  projectSchema,
  roleSchema,
  taskSchema,
  taskStagesSchema,
  threadListSchema,
  threadSchema,
  type AddProject,
  type Decision,
  type DecisionFormAnswer,
  type DecisionQuestion,
  type Message,
  type Project,
  type PublishingMode,
  type QuestionAnswer,
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
    case "usage-window-used-up":
      return `usage window used up: ${message.engineName}'s ${message.window} until ${message.resetsAt}`;
    case "engine-switched":
      return `engine switched: ${message.fromName}'s ${message.window} until ${message.resetsAt}, on ${message.toName}`;
    case "held":
      return `held (${message.heldBy}): ${message.text}`;
    case "stage-context-limit":
      return `stage-context-limit ${message.limit} at ${message.contextTokens}`;
    case "stage-session-restarted":
      return `stage-session-restarted from ${message.contextTokens}, note ${message.handoverNotePassedOn ? "passed on" : "none"}: ${message.brief.replaceAll("\n", " / ")}`;
    case "decision":
      return `decision: ${message.decision.questions.map(questionLine).join(" / ")}`;
    case "decision-answer":
      return `decision-answer: ${JSON.stringify(message.formAnswer)}`;
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
    case "mcp-server-not-started":
      return `mcp-server-not-started ${message.server}: ${message.reason ?? "(no reason)"}`;
    case "changes-allowed":
      return `changes-allowed: ${message.allowed ? "on" : "off"}`;
    case "consultation-line":
      return `consultation-line: ${message.text}`;
  }
}

function questionLine(question: DecisionQuestion): string {
  if (question.kind === "open") return `${question.question} (open)`;
  const recommended =
    question.kind === "choice" ? [question.recommendation.option] : question.recommendation.options;
  const numbers = recommended.map((option) => option + 1).join(", ");
  return `${question.question} [${question.options.join(" | ")}]${question.kind === "choice" ? "" : " (several)"}, recommends ${numbers}: ${question.recommendation.reason}`;
}

/** A Decision's first question as the checks read it; an open question's options are none. */
export function firstQuestion(decision: Decision): {
  readonly question: string;
  readonly options: readonly string[];
  readonly recommended: number;
} {
  const [first] = decision.questions;
  if (!first) throw new Error(`Decision ${decision.id} asks no question.`);
  switch (first.kind) {
    case "choice":
      return {
        question: first.question,
        options: first.options,
        recommended: first.recommendation.option,
      };
    case "choice-of-several":
      return {
        question: first.question,
        options: first.options,
        recommended: first.recommendation.options[0] ?? -1,
      };
    case "open":
      return { question: first.question, options: [], recommended: -1 };
  }
}

/** What a check answers an open question with, leaving the call to the person who asked. */
const OPEN_QUESTION_ANSWER = "Your call: go with what you think best.";

/**
 * Submits the Decision's form: its first question answered with `option`, its recommended one when
 * left out, every other choice with its recommended option, and each open question in words.
 */
export async function submitDecision(api: Api, decision: Decision, option?: number): Promise<void> {
  const answers = decision.questions.map((question, index): QuestionAnswer => {
    if (question.kind === "open") return { kind: "words", text: OPEN_QUESTION_ANSWER };
    if (question.kind === "choice-of-several") {
      return {
        kind: "options",
        options: index === 0 && option !== undefined ? [option] : question.recommendation.options,
      };
    }
    return {
      kind: "option",
      option: index === 0 && option !== undefined ? option : question.recommendation.option,
    };
  });
  const body: DecisionFormAnswer = { kind: "submitted", answers };
  await api("POST", `/decisions/${decision.id}/answer`, body);
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

/** The engine a check's Roles work with, when OFFICE_CHECK_ENGINE names one. */
const CHECK_ENGINE = engineIdSchema.optional().parse(process.env["OFFICE_CHECK_ENGINE"]);

/**
 * Hires each Role from its preset on Haiku at low effort, the cheapest that proves a check, as a
 * Role override on the engine OFFICE_CHECK_ENGINE names, else the Office default's.
 */
export async function hireOnHaiku(
  api: Api,
  hires: readonly (readonly [roleKey: string, name: string])[],
): Promise<void> {
  const { officeDefault } = engineSettingsSchema.parse(await api("GET", "/settings/engines"));
  const engineId = CHECK_ENGINE ?? officeDefault?.engineId;
  if (engineId === undefined) {
    throw new Error("Settings › Engines lists no engine; add one before a live check.");
  }
  for (const [roleKey, name] of hires) {
    const hired = roleSchema.parse(await api("POST", "/roles", { roleKey, name }));
    await api("PUT", `/roles/${roleKey}/card`, {
      ...hired.card,
      roleOverride: { engineId, model: "claude-haiku-5-5" },
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
  const project: AddProject = {
    name: "notnullsoft-admin",
    path,
    baseBranch,
    mark: { label: "NA", colour: "teal" },
    installCommand: "npm install",
    commands: [
      {
        key: "build",
        name: "Build",
        kind: "build",
        commandLine: "npm run build",
        rerunCommandLine: "",
      },
      {
        key: "lint",
        name: "Lint",
        kind: "lint",
        commandLine: "npm run lint",
        rerunCommandLine: "",
      },
      { key: "test", name: "Test", kind: "test", commandLine: "npm test", rerunCommandLine: "" },
    ],
    installInputs: ["package-lock.json"],
    publishingMode,
    defaultPipeline: "quick-fix",
  };
  return projectSchema.parse(await api("POST", "/projects", project));
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

/** The user's first message in a planning Thread, which starts the Planner (spec 2.1). */
export const FIRST_PLANNING_MESSAGE =
  "Let's plan this Task. Read what you need of it and its worktree, then ask me what is unclear, starting with what must be true when it is done.";

/** Sends the user's first message in a planning Thread and waits for the Planner's answer. */
export async function startPlanner(api: Api, threadId: string, timeoutMs: number): Promise<void> {
  await api("POST", `/threads/${threadId}/messages`, { text: FIRST_PLANNING_MESSAGE });
  await untilThreadWaits(api, threadId, timeoutMs);
}

/** The Task a check plans: its Idea, then the plan and Definition of Done the user writes. */
export interface CheckTask {
  readonly title: string;
  readonly notes: string;
  readonly plan: string;
  readonly definitionOfDone: readonly string[];
}

/**
 * Plans `task` on Quick fix as tasks 12 to 15's checks do: the Planner's first answer, its Decisions
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
  await startPlanner(api, planningThread.id, openingMs);
  for (const asked of await openDecisionsOn(api, taskId)) await submitDecision(api, asked);
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
  const lines = [
    `## ${stage.name} (${stage.kind}): ${state}, ${tokensOf(tokens)} tokens ${JSON.stringify(tokens)}`,
  ];
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

/**
 * The option of a Definition of Done Decision that lets the Task finish: "Call it met and publish"
 * when asked before Publish, "Mark the Task Done" at the end of a Pipeline without one; -1 for any
 * other Decision.
 */
export function callingItMet(options: readonly string[]): number {
  const before = options.indexOf("Call it met and publish");
  return before >= 0 ? before : options.indexOf("Mark the Task Done");
}

/**
 * Waits until the Task leaves In progress, calling its Definition of Done met when the check asks,
 * before Publish or at the end.
 */
export async function untilDone(
  api: Api,
  taskId: string,
  timeoutMs: number,
  note: (...lines: string[]) => Promise<void>,
): Promise<Task> {
  let task = await untilWalkStops(api, taskId, timeoutMs);
  for (const asked of await openDecisionsOn(api, taskId)) {
    const { question, options } = firstQuestion(asked);
    await note(`Asked: ${question} [${options.join(" | ")}]`);
    const markDone = callingItMet(options);
    if (!question.includes("Definition of Done") || markDone < 0) break;
    await submitDecision(api, asked, markDone);
    task = await untilWalkStops(api, taskId, timeoutMs);
  }
  return task;
}

/** The key of the Gate the Task waits at: its last run with no action taken yet. */
export async function waitingGate(api: Api, taskId: string): Promise<string> {
  const waiting = (await stagesOf(api, taskId)).filter(
    ({ stage, runs }) => stage.kind === "gate" && runs.at(-1)?.gateAction === null,
  );
  return waiting.map(({ stage }) => stage.key).join(", ") || "no Gate";
}

/** Branches a check never pushes, deletes or commits onto: the Test Project deploys from them. */
const PROTECTED_BRANCHES: readonly string[] = ["main", "master"];

/** The commit `branch` is at on `remote`, or "" when the remote has no such branch. */
export async function remoteHead(
  repositoryPath: string,
  remote: string,
  branch: string,
): Promise<string> {
  const line = await git(repositoryPath, "ls-remote", remote, `refs/heads/${branch}`);
  return line.split("\t")[0] ?? "";
}

/** A file a check's commit changes: `text` written as its whole content, or appended as one line. */
export interface CheckFileChange {
  readonly path: string;
  readonly text: string;
  readonly as: "whole-file" | "appended-line";
}

/**
 * Pushes one commit onto `branch` on `remote`, made on the remote's copy in a temporary worktree, as
 * someone else's push would be: the Test Project's own checkout and branches stay as they were.
 * Refuses any branch `mayPush` doesn't match. Answers the pushed commit.
 */
export async function pushCommitOnto(
  repositoryPath: string,
  commit: {
    readonly remote: string;
    readonly branch: string;
    readonly mayPush: RegExp;
    readonly message: string;
    readonly files: readonly CheckFileChange[];
  },
): Promise<string> {
  const { remote, branch } = commit;
  if (PROTECTED_BRANCHES.includes(branch) || !commit.mayPush.test(branch))
    throw new Error(`Refusing to push a commit onto ${branch}.`);
  await git(repositoryPath, "fetch", remote, branch);
  const folder = await mkdtemp(join(tmpdir(), "office-check-commit-"));
  try {
    await git(repositoryPath, "worktree", "add", "--detach", folder, `${remote}/${branch}`);
    for (const { path, text, as } of commit.files) {
      const file = join(folder, path);
      if (as === "whole-file") {
        await writeFile(file, `${text}\n`);
      } else {
        const before = await readFile(file, "utf8");
        await writeFile(
          file,
          `${before}${before === "" || before.endsWith("\n") ? "" : "\n"}${text}\n`,
        );
      }
    }
    await git(folder, "add", "--", ...commit.files.map(({ path }) => path));
    await git(
      folder,
      "-c",
      "user.name=The Office's check",
      "-c",
      "user.email=office-check@users.noreply.github.com",
      "commit",
      "-m",
      commit.message,
    );
    await git(folder, "push", remote, `HEAD:refs/heads/${branch}`);
    return await git(folder, "rev-parse", "HEAD");
  } finally {
    await quietly(() => git(repositoryPath, "worktree", "remove", "--force", folder));
    await rm(folder, { recursive: true, force: true });
  }
}

/**
 * Leaves the Test Project as it was: the check's worktrees, the Tasks' branches and published-from
 * refs, the Initiative's branch and, for a check that made one, its throwaway base branch removed.
 * With `remote`, the remote's copies of those branches are deleted first. Never main or master.
 */
export async function cleanUpTestProject(
  repositoryPath: string,
  left: {
    readonly base?: string;
    /** The Tasks whose branches are deleted; an undefined one was never made. */
    readonly taskIds: readonly (string | undefined)[];
    readonly initiativeBranch?: string;
    readonly officeData: string;
    /** The remote whose copies of the branches are deleted too; without it, the remote is left alone. */
    readonly remote?: string;
  },
): Promise<void> {
  const taskIds = left.taskIds.filter((taskId) => taskId !== undefined);
  const branches = [
    ...taskIds.map((taskId) => `office/${taskId}`),
    ...(left.initiativeBranch === undefined ? [] : [left.initiativeBranch]),
    ...(left.base === undefined ? [] : [left.base]),
  ].filter((branch) => !PROTECTED_BRANCHES.includes(branch));
  const remote = left.remote;
  if (remote !== undefined) {
    for (const branch of branches) {
      await quietly(async () => {
        if ((await remoteHead(repositoryPath, remote, branch)) !== "")
          await git(repositoryPath, "push", remote, "--delete", branch);
      });
    }
  }
  const officeWorktrees = comparable(left.officeData);
  await quietly(async () => {
    for (const line of (await git(repositoryPath, "worktree", "list", "--porcelain")).split("\n")) {
      const path = line.startsWith("worktree ") ? line.slice("worktree ".length) : "";
      if (path !== "" && comparable(path).startsWith(officeWorktrees))
        await git(repositoryPath, "worktree", "remove", "--force", path);
    }
  });
  await quietly(() => git(repositoryPath, "worktree", "prune"));
  for (const taskId of taskIds) {
    await quietly(() =>
      git(repositoryPath, "update-ref", "-d", `refs/office/published-from/${taskId}`),
    );
  }
  for (const branch of branches) {
    await quietly(() => git(repositoryPath, "branch", "-D", branch));
  }
}
