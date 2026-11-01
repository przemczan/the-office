import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { INestApplication } from "@nestjs/common";
import {
  ideaSchema,
  nowSchema,
  queueSchema,
  roleSchema,
  startAnswerSchema,
  startCheckSchema,
  taskSchema,
  threadListSchema,
  threadSchema,
  type Project,
  type Task,
} from "@the-office/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  addTestProject,
  checkApi,
  comparable,
  git,
  hireOnHaiku,
  openDecisionsOn,
  quietly,
  stageLines,
  stagesOf,
  tokensOf,
  startPlanner,
  untilThreadWaits,
  untilWalkStops,
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
import { GITHUB_SITE } from "../../../platform/git-identity/github-site.js";

/**
 * Task 26's check on the Test Project (docs/tasks/26-parallel-work-and-start-queue.md, step 8): two
 * Tasks planned by the Planner on Haiku, each appending its own line at the end of README.md. With
 * the Developer's Task limit at 1, the second Start warns of the Overlap, is started anyway and
 * queues; raising the limit releases it. Both wait at a Gate before Publish; the first publishes by
 * merge, the second's Publish conflicts, the Developer resolves it in Resolve, "Test after Resolve"
 * passes, "Review the resolved conflict" waits, and Publish fast-forwards the base to the merge
 * commit. Merge mode moves the base on the remote, so the base is a throwaway branch made from
 * origin's main and deleted in the end, never main. Live and publishing, so it runs only when asked
 * for both: OFFICE_ENGINE_TESTS=live, OFFICE_PUBLISH_CHECK=merge and OFFICE_TEST_PROJECT=<the Test
 * Project's folder>, with OFFICE_CHECK_REPORT=<a file> to keep what it saw. It hires the Planner
 * and the Developer from their presets, so it runs alone.
 */
const MODE = process.env["OFFICE_ENGINE_TESTS"];
const PUBLISH_CHECK = process.env["OFFICE_PUBLISH_CHECK"];
const TEST_PROJECT = process.env["OFFICE_TEST_PROJECT"];
const REPORT = process.env["OFFICE_CHECK_REPORT"];
const WEB_APP = fileURLToPath(new URL("../../../../../web", import.meta.url));
const PLANNER_MS = 240_000;
/** How long a walk may take to stop: the install before the first run takes the longest. */
const WALK_MS = 30 * 60_000;
const REMOTE = "origin";
/** The only base branches this check may publish into: never one the Test Project deploys from. */
const THROWAWAY_BRANCH = /^office-check-26-[0-9a-f]{8}$/;
const TASK_BRANCH = /^office\/[0-9a-f-]{36}$/;
const README = "README.md";
const DEVELOPER_NAME = "Ada";

interface CheckIdea {
  readonly title: string;
  readonly notes: string;
  readonly line: string;
}

function checkIdea(title: string, line: string): CheckIdea {
  const notes = [
    `Append exactly one line at the very end of ${README}, at the repository's root: ${line}`,
    "Change no other file. There is nothing to decide: write the Plan with the files it changes and the Definition of Done right away.",
  ].join("\n\n");
  return { title, notes, line };
}

const IDEAS: readonly CheckIdea[] = [
  checkIdea(
    "Say on the README who checked the first parallel Task",
    "Checked by The Office: the first of two parallel Tasks.",
  ),
  checkIdea(
    "Say on the README who checked the second parallel Task",
    "Checked by The Office: the second of two parallel Tasks.",
  ),
];

/** A Gate before Publish in Quick fix: Implement → Tests → Gate → Publish. */
const GATE: Stage = { kind: "gate", key: "look", name: "Look", optional: false };

describe.runIf(MODE === "live" && PUBLISH_CHECK === "merge" && TEST_PROJECT !== undefined)(
  "Task 26's check on the Test Project",
  () => {
    it(
      "queues a Start, warns of an Overlap, and resolves the second Task's conflict at Publish into a throwaway branch",
      async () => {
        const testProject = TEST_PROJECT ?? "";
        const folder = await mkdtemp(join(tmpdir(), "office-parallel-check-"));
        const officeData = join(folder, "office-data");
        const report: string[] = [];
        const begun = Date.now();
        const note = async (...lines: string[]): Promise<void> => {
          const seconds = Math.round((Date.now() - begun) / 1000);
          report.push(...lines.map((line, i) => (i === 0 ? `[${seconds} s] ${line}` : line)));
          // For the task's Progress log: vitest keeps a passing test's console to itself.
          if (REPORT) await writeFile(REPORT, `${report.join("\n")}\n`);
        };
        const throwaway = `office-check-26-${randomBytes(4).toString("hex")}`;
        const mainBefore = await git(testProject, "rev-parse", "main");
        const remoteMainBefore = await remoteHead(testProject, "main");
        let app: INestApplication | undefined;
        let pushedThrowaway = false;
        const taskIds: string[] = [];
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
          const { api, call } = checkApi(url);
          await hireOnHaiku(api, [
            ["planner", "Jan"],
            ["developer", DEVELOPER_NAME],
          ]);
          await setDeveloperTaskLimit(api, 1);
          const project = await addTestProject(api, testProject, {
            baseBranch: throwaway,
            publishingMode: "merge",
          });
          await refuseUnlessThrowaway(project, testProject);
          await note(`Project on ${project.baseBranch} (${project.publishingMode})`);

          // Both planned before either starts, so both branch from the same base.
          for (const idea of IDEAS) {
            const planned = await planWithThePlanner(api, project, idea, note);
            taskIds.push(planned.id);
          }
          const [first, second] = taskIds;
          if (first === undefined || second === undefined)
            throw new Error("Two Tasks were not planned.");
          const stagesRepository = app.get(TaskStagesRepository, { strict: false });
          for (const taskId of taskIds) await seedGateBeforePublish(stagesRepository, taskId);
          await note(`Seeded Stages on both: Implement → Tests → ${GATE.name} → Publish`);

          // The queue and the Overlap: the Developer is at the Task limit once the first starts.
          const firstStart = startAnswerSchema.parse(await api("POST", `/tasks/${first}/start`));
          expect(firstStart.task.state).toBe("in-progress");
          const startCheck = startCheckSchema.parse(await api("GET", `/tasks/${second}/start`));
          const unanswered = await call("POST", `/tasks/${second}/start`);
          const unansweredWords = await unanswered.text();
          await note(
            `Second's start check: ${JSON.stringify(startCheck)}`,
            `  Start without an answer: ${unanswered.status} ${unansweredWords}`,
          );
          expect(startCheck.refusals).toEqual([]);
          expect(startCheck.waits).toEqual([`${DEVELOPER_NAME} is at the Task limit (1).`]);
          expect(startCheck.overlaps).toEqual([
            expect.objectContaining({ taskId: first, files: expect.arrayContaining([README]) }),
          ]);
          expect(unanswered.ok).toBe(false);

          const anyway = startAnswerSchema.parse(
            await api("POST", `/tasks/${second}/start`, { onOverlap: "start-anyway" }),
          );
          const queue = queueSchema.parse(await api("GET", "/queue"));
          const now = nowSchema.parse(await api("GET", "/now"));
          await note(
            `Start anyway: ${anyway.task.state}, queued ${JSON.stringify(anyway.queued)}`,
            `  GET /queue: ${JSON.stringify(queue)}`,
            `  Now's queue: ${JSON.stringify(now.queue)}`,
          );
          expect(anyway.task.state).toBe("ready");
          expect(anyway.queued).toMatchObject({ taskId: second, place: 1, behind: [] });
          expect(queue.map(({ taskId, place }) => ({ taskId, place }))).toEqual([
            { taskId: second, place: 1 },
          ]);
          expect(now.queue).toEqual([
            expect.objectContaining({
              taskId: second,
              place: 1,
              reasons: [`${DEVELOPER_NAME} is at the Task limit (1).`],
            }),
          ]);

          // Raising the limit frees a desk for the Developer: the queue releases the second.
          await setDeveloperTaskLimit(api, 2);
          await untilTaskState(api, second, "in-progress");
          await note(
            `Task limit raised to 2: the second started by itself; queue ${JSON.stringify(queueSchema.parse(await api("GET", "/queue")))}`,
          );
          expect(queueSchema.parse(await api("GET", "/queue"))).toEqual([]);

          for (const taskId of taskIds) {
            const task = await untilWalkStops(api, taskId, WALK_MS);
            await note(`${task.title}: ${task.state} at ${await waitingStage(api, taskId)}`);
            expect(await waitingStage(api, taskId)).toBe(GATE.key);
          }

          // The first publishes: merge mode fast-forwards the throwaway base.
          await refuseUnlessThrowaway(project, testProject);
          await api("POST", `/tasks/${first}/gate/continue`);
          expect((await untilDone(api, first, note)).state).toBe("done");
          const firstPublished = await remoteHead(testProject, throwaway);
          await note(`First published: ${REMOTE}/${throwaway} at ${firstPublished}`);

          // The second's Publish conflicts: Resolve, Test after Resolve, then the Gate.
          await refuseUnlessThrowaway(project, testProject);
          await api("POST", `/tasks/${second}/gate/continue`);
          const atReview = await untilWalkStops(api, second, WALK_MS);
          const worktree = join(officeData, "worktrees", project.id, second);
          const resolved = await readFile(join(worktree, README), "utf8").catch(() => "");
          await note(
            `Second: ${atReview.state} at ${await waitingStage(api, second)}`,
            `  ${README}'s last lines after Resolve:`,
            ...resolved
              .trimEnd()
              .split("\n")
              .slice(-4)
              .map((line) => `  > ${line}`),
          );
          expect(await waitingStage(api, second)).toBe("office:resolve-gate");
          const mergeCommit = await git(worktree, "rev-parse", "HEAD");
          for (const idea of IDEAS) expect(resolved).toContain(idea.line);

          await refuseUnlessThrowaway(project, testProject);
          await api("POST", `/tasks/${second}/gate/continue`);
          expect((await untilDone(api, second, note)).state).toBe("done");
          const interpreter = app.get(StageInterpreter, { strict: false });
          for (const taskId of taskIds) {
            await interpreter.walked(taskId);
            for (const stage of await stagesOf(api, taskId)) {
              await note(...(await stageLines(api, stage)));
            }
          }

          const secondPublished = await remoteHead(testProject, throwaway);
          await git(testProject, "fetch", REMOTE, throwaway);
          const parents = (await git(testProject, "rev-list", "--parents", "-n", "1", mergeCommit))
            .split(" ")
            .slice(1);
          await note(
            `Second published: ${REMOTE}/${throwaway} at ${secondPublished}; the merge commit ${mergeCommit} has parents ${parents.join(", ")}`,
          );
          expect(secondPublished).toBe(mergeCommit);
          expect(parents).toHaveLength(2);
          expect(parents[1]).toBe(firstPublished);
          expect(await git(testProject, "rev-parse", "main")).toBe(mainBefore);
          expect(await remoteHead(testProject, "main")).toBe(remoteMainBefore);
        } finally {
          await app?.close();
          await cleanUp(testProject, { throwaway, pushedThrowaway, taskIds, officeData });
          await note(
            `Cleaned up; ${REMOTE} has ${throwaway}: ${(await remoteHead(testProject, throwaway)) !== ""}`,
          );
          await rm(folder, { recursive: true, force: true });
        }
      },
      PLANNER_MS * 6 + WALK_MS * 4,
    );
  },
);

type Note = (...lines: string[]) => Promise<void>;

/**
 * Plans `idea` with the Planner and keeps what it wrote: the Plan with its files to change. The
 * user writes the Definition of Done (a line among others, as only one line can end the merged
 * README) and confirms the parts.
 */
async function planWithThePlanner(
  api: Api,
  project: Project,
  idea: CheckIdea,
  note: Note,
): Promise<Task> {
  const shaped = ideaSchema.parse(
    await api("POST", "/ideas", { title: idea.title, notes: idea.notes, projectId: project.id }),
  );
  const taskId = taskSchema.parse(
    await api("POST", `/ideas/${shaped.id}/shape`, { projectId: project.id }),
  ).id;
  await api("POST", `/tasks/${taskId}/planning`);
  const thread = threadListSchema.parse(await api("GET", `/tasks/${taskId}/threads`))[0];
  if (!thread) throw new Error("Planning opened no Thread.");
  await startPlanner(api, thread.id, PLANNER_MS);
  for (const asked of await openDecisionsOn(api, taskId)) {
    await api("POST", `/decisions/${asked.id}/answer`, {
      kind: "option",
      option: asked.recommendation.option,
    });
    await untilThreadWaits(api, thread.id, PLANNER_MS);
  }
  let task = taskSchema.parse(await api("GET", `/tasks/${taskId}`));
  if (task.plan === "" || task.filesToChange.length === 0) {
    await api("POST", `/threads/${thread.id}/messages`, {
      text: "Please write the Plan now with write_plan, with filesToChange listing the files it changes.",
    });
    await untilThreadWaits(api, thread.id, PLANNER_MS);
    task = taskSchema.parse(await api("GET", `/tasks/${taskId}`));
  }
  const forced = task.filesToChange.length === 0;
  const { tokens } = threadSchema.parse(await api("GET", `/threads/${thread.id}`));
  await note(
    `Task ${taskId} "${task.title}": Planning Thread tokens ${tokensOf(tokens)} ${JSON.stringify(tokens)}`,
    `  Plan: ${task.plan.replaceAll("\n", " / ")}`,
    `  Files to change, as the Planner wrote them: ${JSON.stringify(task.filesToChange)}${forced ? `; set to ["${README}"] by the check` : ""}`,
  );
  if (task.plan === "") throw new Error("The Planner wrote no Plan.");
  await api("PUT", `/tasks/${taskId}/plan`, {
    plan: task.plan,
    ...(forced ? { filesToChange: [README] } : {}),
  });
  await api("PUT", `/tasks/${taskId}/definition-of-done`, {
    definitionOfDone: [
      `${README} contains the line "${idea.line}"`,
      "No other file is changed, and npm test passes.",
    ],
  });
  await api("PUT", `/tasks/${taskId}/pipeline`, { pipelineId: "quick-fix" });
  const ready = taskSchema.parse(await api("POST", `/tasks/${taskId}/ready`));
  expect(ready.state).toBe("ready");
  return ready;
}

async function seedGateBeforePublish(
  repository: TaskStagesRepository,
  taskId: string,
): Promise<void> {
  const quickFix = builtInPipelines.find(({ id }) => id === "quick-fix");
  if (!quickFix) throw new Error("There is no built-in Quick fix.");
  const publishAt = quickFix.stages.findIndex(({ key }) => key === "publish");
  const stages = quickFix.stages.toSpliced(publishAt, 0, GATE);
  await repository.save(makeTaskStages(taskId, { ...quickFix, stages }, new Date()).taskStages);
}

async function setDeveloperTaskLimit(api: Api, taskLimit: number): Promise<void> {
  const { card } = roleSchema.parse(await api("GET", "/roles/developer"));
  await api("PUT", "/roles/developer/card", { ...card, taskLimit });
}

async function untilTaskState(api: Api, taskId: string, state: Task["state"]): Promise<void> {
  await vi.waitFor(
    async () => {
      const task = taskSchema.parse(await api("GET", `/tasks/${taskId}`));
      if (task.state !== state) throw new Error(`Still ${task.state}.`);
    },
    { timeout: 60_000, interval: 1_000 },
  );
}

/** The key of the Gate the Task waits at: its last run with no action taken yet. */
async function waitingStage(api: Api, taskId: string): Promise<string> {
  const waiting = (await stagesOf(api, taskId)).filter(
    ({ stage, runs }) => stage.kind === "gate" && runs.at(-1)?.gateAction === null,
  );
  return waiting.map(({ stage }) => stage.key).join(", ") || "no Gate";
}

/** Walks on after Publish, marking the Task Done when the Definition of Done check asks. */
async function untilDone(api: Api, taskId: string, note: Note): Promise<Task> {
  let task = await untilWalkStops(api, taskId, WALK_MS);
  for (const asked of await openDecisionsOn(api, taskId)) {
    await note(`Asked: ${asked.question} [${asked.options.join(" | ")}]`);
    const markDone = asked.options.indexOf("Mark the Task Done");
    if (!asked.question.includes("Definition of Done") || markDone < 0) break;
    await api("POST", `/decisions/${asked.id}/answer`, { kind: "option", option: markDone });
    task = await untilWalkStops(api, taskId, WALK_MS);
  }
  return task;
}

/**
 * Throws before anything is published unless the Project merges into the throwaway branch, which
 * tracks its own remote copy.
 */
async function refuseUnlessThrowaway(project: Project, repositoryPath: string): Promise<void> {
  if (["main", "master"].includes(project.baseBranch) || !THROWAWAY_BRANCH.test(project.baseBranch))
    throw new Error(`Refusing to publish into ${project.baseBranch}: not a throwaway branch.`);
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

/**
 * Leaves the Test Project and its remote as they were: the remote throwaway and Task branches
 * deleted, then the Tasks' local refs, branches and the check's own worktrees. Each part goes on
 * when an earlier one fails or finds nothing.
 */
async function cleanUp(
  repositoryPath: string,
  left: {
    readonly throwaway: string;
    readonly pushedThrowaway: boolean;
    readonly taskIds: readonly string[];
    readonly officeData: string;
  },
): Promise<void> {
  for (const taskId of left.taskIds) {
    const taskBranch = `office/${taskId}`;
    if ((await remoteHead(repositoryPath, taskBranch)) !== "")
      await quietly(() => pushTo(repositoryPath, taskBranch, [REMOTE, "--delete", taskBranch]));
  }
  if (left.pushedThrowaway) {
    await quietly(() =>
      pushTo(repositoryPath, left.throwaway, [REMOTE, "--delete", left.throwaway]),
    );
  }
  // Only the check's own worktrees: the user's Office keeps its own elsewhere.
  const checkWorktrees = comparable(left.officeData);
  await quietly(async () => {
    for (const line of (await git(repositoryPath, "worktree", "list", "--porcelain")).split("\n")) {
      const path = line.startsWith("worktree ") ? line.slice("worktree ".length) : "";
      if (path !== "" && comparable(path).startsWith(checkWorktrees))
        await git(repositoryPath, "worktree", "remove", "--force", path);
    }
  });
  await quietly(() => git(repositoryPath, "worktree", "prune"));
  for (const taskId of left.taskIds) {
    await quietly(() =>
      git(repositoryPath, "update-ref", "-d", `refs/office/published-from/${taskId}`),
    );
    await quietly(() => git(repositoryPath, "branch", "-D", `office/${taskId}`));
  }
  await quietly(() => git(repositoryPath, "branch", "-D", left.throwaway));
  await quietly(() =>
    git(repositoryPath, "branch", "--remotes", "--delete", `${REMOTE}/${left.throwaway}`),
  );
}
