import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { INestApplication } from "@nestjs/common";
import {
  ideaSchema,
  taskChangesSchema,
  taskSchema,
  threadListSchema,
  threadSchema,
  type Project,
  type Task,
  type TaskChanges,
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
  untilThreadWaits,
  type Api,
} from "../../../../test/live-check.js";
import { startTestApplication } from "../../../../test/test-application.js";
import { testDatabaseUrl } from "../../../../test/test-database.js";
import { AppModule } from "../../../app.module.js";
import { builtInPipelines } from "../domain/built-in-pipelines.js";
import type { Stage } from "../domain/stage.js";
import { makeTaskStages } from "../domain/task-stages.js";
import { TaskStagesRepository } from "../ports/task-stages-repository.js";
import { StageInterpreter } from "./stage-interpreter.js";

/**
 * Task 14's check on the Test Project (docs/tasks/14-gates-publish.md, step 5): a Task on Quick fix
 * with a Gate before Publish, worked by the Developer on Haiku, waits on the user at the Gate, is
 * continued, and Publish pushes its branch and opens a real pull request. Publishing leaves the
 * workstation, so the check keeps to what the user allowed: it pushes a throwaway base branch made
 * from origin's main, publishes in push + PR mode only, so the pull request goes into that branch,
 * never main, and in the end closes the pull request and deletes both remote branches and every
 * local ref it left. Live and publishing, so it runs only when asked for both:
 * OFFICE_ENGINE_TESTS=live, OFFICE_PUBLISH_CHECK=push-and-pull-request and
 * OFFICE_TEST_PROJECT=<the Test Project's folder>, with OFFICE_CHECK_REPORT=<a file> to keep what
 * it saw. It hires the Planner and the Developer from their presets, so it runs alone.
 */
const MODE = process.env["OFFICE_ENGINE_TESTS"];
const PUBLISH_CHECK = process.env["OFFICE_PUBLISH_CHECK"];
const TEST_PROJECT = process.env["OFFICE_TEST_PROJECT"];
const REPORT = process.env["OFFICE_CHECK_REPORT"];
const WEB_APP = fileURLToPath(new URL("../../../../../web", import.meta.url));
const PLANNER_OPENING_MS = 240_000;
/** How long the walk may take to stop: the install before the first run takes the longest. */
const WALK_MS = 30 * 60_000;
const REMOTE = "origin";
/** The only base branches this check may publish into: never one the Test Project deploys from. */
const THROWAWAY_BRANCH = /^office-check-14-[0-9a-f]{8}$/;
const TASK_BRANCH = /^office\/[0-9a-f-]{36}$/;
const STOPPED_STATES: readonly Task["state"][] = ["done", "waiting-on-you", "dropped", "paused"];
const run = promisify(execFile);

const README_LINE = "Published by The Office's check of task 14.";
const PLAN = [
  `Add one line at the very end of README.md, at the repository's root: ${README_LINE}`,
  "Change nothing else.",
].join("\n\n");
const DEFINITION_OF_DONE = [
  `README.md ends with the line "${README_LINE}"`,
  "No other file is changed, and npm test passes.",
];

/** A Gate before Publish in Quick fix: Implement → Tests → Gate → Publish. */
const GATE: Stage = { kind: "gate", key: "look", name: "Look", optional: false };

describe.runIf(
  MODE === "live" && PUBLISH_CHECK === "push-and-pull-request" && TEST_PROJECT !== undefined,
)("Task 14's check on the Test Project", () => {
  it(
    "waits on the user at a Gate, continues to Publish, and opens a pull request into a throwaway branch",
    async () => {
      const testProject = TEST_PROJECT ?? "";
      const folder = await mkdtemp(join(tmpdir(), "office-publish-check-"));
      const officeData = join(folder, "office-data");
      const report: string[] = [];
      const begun = Date.now();
      const note = async (...lines: string[]): Promise<void> => {
        const seconds = Math.round((Date.now() - begun) / 1000);
        report.push(...lines.map((line, i) => (i === 0 ? `[${seconds} s] ${line}` : line)));
        // For the task's Progress log: vitest keeps a passing test's console to itself.
        if (REPORT) await writeFile(REPORT, `${report.join("\n")}\n`);
      };
      const throwaway = `office-check-14-${randomBytes(4).toString("hex")}`;
      const mainBefore = await git(testProject, "rev-parse", "main");
      const remoteMainBefore = await remoteHead(testProject, "main");
      let app: INestApplication | undefined;
      let pushedThrowaway = false;
      let taskId: string | undefined;
      let pullRequest: string | undefined;
      try {
        await git(testProject, "fetch", REMOTE, "main");
        await git(testProject, "branch", "--no-track", throwaway, `${REMOTE}/main`);
        await note(`Pushing the throwaway base branch: ${REMOTE} ${throwaway}`);
        await pushTo(testProject, throwaway, ["--set-upstream", REMOTE, throwaway]);
        pushedThrowaway = true;

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
        const project = await addTestProject(api, testProject, {
          baseBranch: throwaway,
          publishingMode: "push-and-pull-request",
        });
        await refuseUnlessThrowaway(project, testProject);
        await note(`Project on ${project.baseBranch} (${project.publishingMode})`);

        const planned = await planOnQuickFix(api, project);
        taskId = planned.taskId;
        await note(
          `Task ${taskId} Ready; Planning Thread tokens ${tokensOf(planned.tokens)} ${JSON.stringify(planned.tokens)}`,
        );
        const worktreePath = join(officeData, "worktrees", project.id, taskId);
        const repository = app.get(TaskStagesRepository, { strict: false });
        const quickFix = builtInPipelines.find(({ id }) => id === "quick-fix");
        if (!quickFix) throw new Error("There is no built-in Quick fix.");
        const publishAt = quickFix.stages.findIndex(({ key }) => key === "publish");
        const stages = quickFix.stages.toSpliced(publishAt, 0, GATE);
        const { taskStages } = makeTaskStages(taskId, { ...quickFix, stages }, new Date());
        await repository.save(taskStages);
        await note(`Seeded Stages: ${stages.map(({ name }) => name).join(" → ")}`);

        await api("POST", `/tasks/${taskId}/start`);
        let task = await untilWalkStops(api, taskId);
        const atGate = await stagesOf(api, taskId);
        const gate = atGate.find(({ stage }) => stage.key === GATE.key);
        const waitingAtGate =
          task.state === "waiting-on-you" &&
          (await openDecisionsOn(api, taskId)).length === 0 &&
          gate?.runs.at(-1)?.gateAction === null;
        const changesAtGate = await changesOf(api, project.id, taskId);
        await note(
          `Task ${task.state}; waiting at the Gate: ${waitingAtGate}`,
          `  Changes at the Gate: ${changesAtGate.files.map(({ path }) => path).join(", ")}`,
        );
        expect(waitingAtGate).toBe(true);
        // The user looks before going on: nothing the Task changed may reach the workflows.
        if (changesAtGate.files.some(({ path }) => path.startsWith(".github/"))) {
          await api("POST", `/tasks/${taskId}/gate/drop`);
          throw new Error("The Task changed .github/; dropped at the Gate, nothing published.");
        }

        await refuseUnlessThrowaway(project, testProject);
        await note(`Continue: Publish opens a pull request into ${REMOTE}/${throwaway}`);
        await api("POST", `/tasks/${taskId}/gate/continue`);
        task = await untilWalkStops(api, taskId);
        for (const asked of await openDecisionsOn(api, taskId)) {
          // The Definition of Done is checked after the last Stage, here after Publish.
          await note(`Asked after Publish: ${asked.question} [${asked.options.join(" | ")}]`);
          const markDone = asked.options.indexOf("Mark the Task Done");
          if (!asked.question.includes("Definition of Done") || markDone < 0) break;
          await api("POST", `/decisions/${asked.id}/answer`, { kind: "option", option: markDone });
          task = await untilWalkStops(api, taskId);
        }
        await app.get(StageInterpreter, { strict: false }).walked(taskId);
        for (const stage of await stagesOf(api, taskId)) {
          await note(...(await stageLines(api, stage)));
        }

        const taskBranch = `office/${taskId}`;
        pullRequest = await pullRequestOf(testProject, taskBranch, throwaway);
        const opened = await pullRequestView(testProject, pullRequest);
        const changesAfter = await changesOf(api, project.id, taskId);
        const worktreeGone = await access(worktreePath).then(
          () => false,
          () => true,
        );
        const publishedFrom = await git(
          testProject,
          "rev-parse",
          "--verify",
          "--quiet",
          `refs/office/published-from/${taskId}`,
        ).catch(() => "");
        await note(
          `Task ${task.state}; pull request ${opened.url}: ${opened.headRefName} into ${opened.baseRefName}, ${opened.state}`,
          `  published from ${publishedFrom || "nowhere"} (${remoteMainBefore} is origin's main)`,
          `  worktree removed: ${worktreeGone}; Changes after Publish: ${changesAfter.files.map(({ path }) => path).join(", ")} (worktree ${changesAfter.worktreePath ?? "none"})`,
          "  body:",
          ...opened.body.split("\n").map((line) => `  > ${line}`),
        );

        expect(task.state).toBe("done");
        expect(opened.baseRefName).toBe(throwaway);
        expect(opened.headRefName).toBe(taskBranch);
        expect(opened.body).toContain("## Definition of Done");
        for (const statement of DEFINITION_OF_DONE) expect(opened.body).toContain(statement);
        expect(opened.body).toContain("## Stage results");
        expect(publishedFrom).toBe(remoteMainBefore);
        expect(worktreeGone).toBe(true);
        expect(changesAfter.worktreePath).toBeNull();
        expect(changesAfter.files.map(({ path }) => path)).toContain("README.md");
        expect(await git(testProject, "rev-parse", "main")).toBe(mainBefore);
        expect(await remoteHead(testProject, "main")).toBe(remoteMainBefore);
      } finally {
        await app?.close();
        await cleanUp(testProject, { throwaway, pushedThrowaway, taskId, pullRequest, officeData });
        await note(
          `Cleaned up; ${REMOTE} has ${throwaway}: ${(await remoteHead(testProject, throwaway)) !== ""}, has office/${taskId ?? "?"}: ${taskId !== undefined && (await remoteHead(testProject, `office/${taskId}`)) !== ""}`,
        );
        await rm(folder, { recursive: true, force: true });
      }
    },
    PLANNER_OPENING_MS * 2 + WALK_MS * 2,
  );
});

/** Throws before anything is published unless the Project publishes into the throwaway branch. */
async function refuseUnlessThrowaway(project: Project, repositoryPath: string): Promise<void> {
  if (["main", "master"].includes(project.baseBranch) || !THROWAWAY_BRANCH.test(project.baseBranch))
    throw new Error(`Refusing to publish into ${project.baseBranch}: not a throwaway branch.`);
  if (project.publishingMode !== "push-and-pull-request")
    throw new Error(`Refusing to publish in ${project.publishingMode} mode: push + PR only.`);
  const upstream = await git(
    repositoryPath,
    "rev-parse",
    "--abbrev-ref",
    `${project.baseBranch}@{u}`,
  );
  if (upstream !== `${REMOTE}/${project.baseBranch}`)
    throw new Error(`Refusing: ${project.baseBranch} tracks ${upstream}, not its own remote copy.`);
}

/** Pushes, with `branch` checked against the throwaway or Task patterns first: never main. */
async function pushTo(repositoryPath: string, branch: string, args: string[]): Promise<void> {
  if (!THROWAWAY_BRANCH.test(branch) && !TASK_BRANCH.test(branch))
    throw new Error(`Refusing to push ${branch}.`);
  await git(repositoryPath, "push", ...args);
}

/** The commit `branch` is at on the remote, or "" when the remote has no such branch. */
async function remoteHead(repositoryPath: string, branch: string): Promise<string> {
  const line = await git(repositoryPath, "ls-remote", REMOTE, `refs/heads/${branch}`);
  return line.split("\t")[0] ?? "";
}

/** Planned as in tasks 12 and 13's checks: the Planner's opening, then the user writes the parts. */
async function planOnQuickFix(
  api: Api,
  project: Project,
): Promise<{ readonly taskId: string; readonly tokens: Thread["tokens"] }> {
  const idea = ideaSchema.parse(
    await api("POST", "/ideas", {
      title: "Say on the README that The Office published it",
      notes: "A one-line change to check publishing.",
      projectId: project.id,
    }),
  );
  const taskId = taskSchema.parse(
    await api("POST", `/ideas/${idea.id}/shape`, { projectId: project.id }),
  ).id;
  await api("POST", `/tasks/${taskId}/planning`);
  const planningThread = threadListSchema.parse(await api("GET", `/tasks/${taskId}/threads`))[0];
  if (!planningThread) throw new Error("Planning opened no Thread.");
  await untilThreadWaits(api, planningThread.id, PLANNER_OPENING_MS);
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
  const { tokens } = threadSchema.parse(await api("GET", `/threads/${planningThread.id}`));
  return { taskId, tokens };
}

async function untilWalkStops(api: Api, taskId: string): Promise<Task> {
  return vi.waitFor(
    async () => {
      const task = taskSchema.parse(await api("GET", `/tasks/${taskId}`));
      if (!STOPPED_STATES.includes(task.state)) throw new Error(task.state);
      return task;
    },
    { timeout: WALK_MS, interval: 5_000 },
  );
}

/** A path as git and Windows both write it, to compare the two. */
function comparable(path: string): string {
  return path.replaceAll("\\", "/").toLowerCase();
}

async function changesOf(api: Api, projectId: string, taskId: string): Promise<TaskChanges> {
  return taskChangesSchema.parse(
    await api("GET", `/projects/${projectId}/tasks/${taskId}/changes`),
  );
}

async function gh(repositoryPath: string, ...args: string[]): Promise<string> {
  return (await run("gh", args, { cwd: repositoryPath })).stdout.trim();
}

/** The pull request Publish opened for the Task's branch into the throwaway branch. */
async function pullRequestOf(
  repositoryPath: string,
  taskBranch: string,
  baseBranch: string,
): Promise<string> {
  const listed = JSON.parse(
    await gh(
      repositoryPath,
      "pr",
      "list",
      "--head",
      taskBranch,
      "--base",
      baseBranch,
      "--json",
      "url",
    ),
  ) as { url: string }[];
  const opened = listed[0];
  if (!opened) throw new Error(`No pull request from ${taskBranch} into ${baseBranch}.`);
  return opened.url;
}

interface PullRequestView {
  readonly url: string;
  readonly state: string;
  readonly baseRefName: string;
  readonly headRefName: string;
  readonly body: string;
}

async function pullRequestView(repositoryPath: string, url: string): Promise<PullRequestView> {
  return JSON.parse(
    await gh(repositoryPath, "pr", "view", url, "--json", "url,state,baseRefName,headRefName,body"),
  ) as PullRequestView;
}

/** One part of the clean-up: what fails is said, and the rest goes on. */
async function quietly(work: () => Promise<unknown>): Promise<void> {
  await work().catch((error: unknown) => {
    console.warn(`Clean-up: ${String(error)}`);
  });
}

/**
 * Leaves the Test Project and its remote as they were: the pull request closed, both remote
 * branches deleted, then the Task's local refs, branches and worktrees. Each part goes on when an
 * earlier one fails or finds nothing.
 */
async function cleanUp(
  repositoryPath: string,
  left: {
    readonly throwaway: string;
    readonly pushedThrowaway: boolean;
    readonly taskId: string | undefined;
    readonly pullRequest: string | undefined;
    readonly officeData: string;
  },
): Promise<void> {
  const taskBranch = left.taskId === undefined ? undefined : `office/${left.taskId}`;
  if (left.pullRequest) {
    const pullRequest = left.pullRequest;
    await quietly(() => gh(repositoryPath, "pr", "close", pullRequest));
  }
  if (taskBranch && (await remoteHead(repositoryPath, taskBranch)) !== "") {
    await quietly(() => pushTo(repositoryPath, taskBranch, [REMOTE, "--delete", taskBranch]));
  }
  if (left.pushedThrowaway) {
    await quietly(() =>
      pushTo(repositoryPath, left.throwaway, [REMOTE, "--delete", left.throwaway]),
    );
  }
  if (left.taskId !== undefined && taskBranch) {
    const taskId = left.taskId;
    await quietly(() =>
      git(repositoryPath, "update-ref", "-d", `refs/office/published-from/${taskId}`),
    );
    // Publish removes the Task's worktree; this finds one a failed check left.
    const worktrees = comparable(join(left.officeData, "worktrees"));
    await quietly(async () => {
      for (const line of (await git(repositoryPath, "worktree", "list", "--porcelain")).split(
        "\n",
      )) {
        const path = line.startsWith("worktree ") ? line.slice("worktree ".length) : "";
        if (path !== "" && comparable(path).startsWith(worktrees))
          await git(repositoryPath, "worktree", "remove", "--force", path);
      }
    });
    await quietly(() => git(repositoryPath, "branch", "-D", taskBranch));
  }
  await quietly(() =>
    git(
      repositoryPath,
      "worktree",
      "remove",
      "--force",
      join(left.officeData, "bases", "notnullsoft-admin"),
    ),
  );
  await quietly(() => git(repositoryPath, "worktree", "prune"));
  await quietly(() => git(repositoryPath, "branch", "-D", left.throwaway));
}
