import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { INestApplication } from "@nestjs/common";
import {
  ideaSchema,
  initiativeBranchOf,
  initiativeSchema,
  messageListSchema,
  officeUpdateSchema,
  pipelineSchema,
  taskChangesSchema,
  taskListSchema,
  taskSchema,
  taskStagesSchema,
  threadListSchema,
  threadSchema,
  type Initiative,
  type Message,
  type OfficeUpdate,
  type Project,
  type Stage,
  type Task,
  type TaskChanges,
} from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import {
  addTestProject,
  checkApi,
  cleanUpTestProject,
  git,
  hireOnHaiku,
  openDecisionsOn,
  pushCommitOnto,
  remoteHead,
  stageLines,
  stagesOf,
  startPlanner,
  submitDecision,
  tokensOf,
  untilDone,
  untilThreadWaits,
  untilWalkStops,
  waitingGate,
  type Api,
} from "../../../../test/live-check.js";
import { startTestApplication } from "../../../../test/test-application.js";
import { testDatabaseUrl } from "../../../../test/test-database.js";
import { AppModule } from "../../../app.module.js";
import { GITHUB_SITE } from "../../../platform/git-identity/github-site.js";
import { Briefs, ThreadRepository } from "../../conversations/index.fixtures.js";
import { TaskRepository } from "../ports/task-repository.js";

/**
 * The Initiative 1116efba's check on the Test Project (Task a07fca92): an Initiative shaped with the
 * CTO, who chooses its Pipeline, and confirmed, so it has its own branch; Task A planned in its
 * planning Thread and Task B in a Planner's Thread of its own, each publishing into the Initiative's
 * branch by merge, B's Publish conflicting with a commit pushed onto the base branch while it waited
 * at its Gate; the chats reading the branch; and the Publishing Task The Office adds once both are
 * Done, whose Gate shows the whole change and whose Publish merges it into the base branch. Merge
 * mode moves the base on the remote, so the base is a throwaway branch made from origin's main and
 * deleted in the end, never main. Live and publishing, so it runs only when asked for both:
 * OFFICE_ENGINE_TESTS=live, OFFICE_PUBLISH_CHECK=merge and OFFICE_TEST_PROJECT=<a clone of the Test
 * Project made for the check>, with OFFICE_CHECK_REPORT=<a file> to keep what it saw. It hires the
 * CTO, the Planner and the Developer from their presets, so it runs alone.
 */
const MODE = process.env["OFFICE_ENGINE_TESTS"];
const PUBLISH_CHECK = process.env["OFFICE_PUBLISH_CHECK"];
const TEST_PROJECT = process.env["OFFICE_TEST_PROJECT"];
const REPORT = process.env["OFFICE_CHECK_REPORT"];
const WEB_APP = fileURLToPath(new URL("../../../../../web", import.meta.url));
/** How long a chat's answer may take: the CTO's or the Planner's. */
const ANSWER_MS = 240_000;
/** How long a walk may take to stop: the install before the first run takes the longest. */
const WALK_MS = 30 * 60_000;
const REMOTE = "origin";
/** The only base branches this check may publish into: never one the Test Project deploys from. */
const THROWAWAY_BRANCH = /^office-check-init-[0-9a-f]{8}$/;
const README = "README.md";
const runCommand = promisify(execFile);

/** What one run's names and lines are made of, each its own by a random hex. */
interface CheckRun {
  readonly hex: string;
  readonly throwaway: string;
  readonly initiativeName: string;
  readonly shortName: string;
  readonly initiativeBranch: string;
  readonly pipelineName: string;
  readonly fileA: string;
  readonly lineA: string;
  readonly lineB: string;
  readonly baseFile: string;
  readonly baseLine: string;
  readonly laterBaseFile: string;
}

function checkRun(hex: string): CheckRun {
  const shortName = `office-check-initiative-${hex}`;
  return {
    hex,
    throwaway: `office-check-init-${hex}`,
    initiativeName: `Office check initiative ${hex}`,
    shortName,
    initiativeBranch: initiativeBranchOf(shortName),
    pipelineName: `Office check ${hex}`,
    fileA: `office-check-${hex}-a.md`,
    lineA: `Office check ${hex}: written by Task A of the Initiative.`,
    lineB: `Office check ${hex}: appended by Task B of the Initiative.`,
    baseFile: `office-check-${hex}-base.md`,
    baseLine: `Office check ${hex}: pushed onto the base branch while B waited at its Gate.`,
    laterBaseFile: `office-check-${hex}-base-2.md`,
  };
}

/** A Task of the Initiative as the check gives it: its notes, then the parts the user writes. */
interface InitiativeTask {
  readonly title: string;
  readonly description: string;
  readonly filesToChange: readonly string[];
  readonly definitionOfDone: readonly string[];
}

const NOTHING_TO_DECIDE =
  "There is nothing to decide: write the Plan with the files it changes and the Definition of Done right away.";

function taskA(run: CheckRun): InitiativeTask {
  return {
    title: `Add ${run.fileA}`,
    description: [
      `Add a new file ${run.fileA} at the repository's root, holding exactly one line: ${run.lineA}`,
      `Change no other file. ${NOTHING_TO_DECIDE}`,
    ].join("\n\n"),
    filesToChange: [run.fileA],
    definitionOfDone: [
      `${run.fileA} at the repository's root holds exactly the line "${run.lineA}"`,
      `No file but ${run.fileA} is changed.`,
    ],
  };
}

function taskB(run: CheckRun): InitiativeTask {
  return {
    title: `Say on the README that Task B of ${run.initiativeName} ran`,
    description: [
      `Append exactly one line at the very end of ${README}, at the repository's root: ${run.lineB}`,
      `Change no other file. ${NOTHING_TO_DECIDE}`,
    ].join("\n\n"),
    filesToChange: [README],
    definitionOfDone: [
      `${README} contains the line "${run.lineB}"`,
      `No file but ${README} is changed.`,
    ],
  };
}

/** A Gate before Publish in Quick fix: Implement → Tests → Gate → Publish. */
const GATE: Stage = { kind: "gate", key: "look", name: "Look", optional: false };

/** The Initiative's Pipeline: no Agent Stage, so its Publishing Task costs no model tokens. */
function initiativePipeline(run: CheckRun): { name: string; description: string; stages: Stage[] } {
  return {
    name: run.pipelineName,
    description: "The Initiative check's Pipeline: Tests, then a Gate, then Publish.",
    stages: [
      { kind: "script", key: "tests", name: "Tests", command: "test", optional: false },
      GATE,
      { kind: "script", key: "publish", name: "Publish", command: "publish", optional: false },
    ],
  };
}

type Note = (...lines: string[]) => Promise<void>;

describe.runIf(MODE === "live" && PUBLISH_CHECK === "merge" && TEST_PROJECT !== undefined)(
  "The Initiative 1116efba's check on the Test Project",
  () => {
    it(
      "shapes an Initiative with a Pipeline, publishes its Tasks into its branch, and its Publishing Task into a throwaway base",
      async () => {
        const testProject = TEST_PROJECT ?? "";
        const folder = await mkdtemp(join(tmpdir(), "office-initiative-check-"));
        const officeData = join(folder, "office-data");
        const report: string[] = [];
        const begun = Date.now();
        const note: Note = async (...lines) => {
          const seconds = Math.round((Date.now() - begun) / 1000);
          report.push(...lines.map((line, i) => (i === 0 ? `[${seconds} s] ${line}` : line)));
          // For the Task's report: vitest keeps a passing test's console to itself.
          if (REPORT) await writeFile(REPORT, `${report.join("\n")}\n`);
        };
        const run = checkRun(randomBytes(4).toString("hex"));
        const { throwaway, initiativeBranch } = run;

        // 1. Recorded first, to check in the end that the check left main alone.
        const mainBefore = await git(testProject, "rev-parse", "main");
        const remoteMainBefore = await remoteHead(testProject, REMOTE, "main");
        let app: INestApplication | undefined;
        let api: Api | undefined;
        let pipelineId: string | undefined;
        const taskIds: string[] = [];
        let mainAfter: { local: string; remote: string } | undefined;
        let pipelineRemoved: string | undefined;
        try {
          // 2. The throwaway base branch, made from origin's main.
          await git(testProject, "fetch", REMOTE, "main");
          await git(testProject, "branch", "--no-track", throwaway, `${REMOTE}/main`);
          await note(`Pushing the throwaway base branch: ${REMOTE} ${throwaway}`);
          await pushThrowaway(testProject, throwaway);

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
          const live = checkApi(url).api;
          api = live;
          await hireOnHaiku(live, [
            ["cto", "Grace"],
            ["planner", "Jan"],
            ["developer", "Ada"],
          ]);
          const project = await addTestProject(live, testProject, {
            baseBranch: throwaway,
            publishingMode: "merge",
          });
          await refuseUnlessThrowaway(project, testProject);
          const baseAtStart = await remoteHead(testProject, REMOTE, throwaway);
          await note(
            `Project ${project.name} on ${project.baseBranch} (${project.publishingMode}) at ${baseAtStart}`,
          );

          // 3. The Initiative's Pipeline, in the library.
          const pipeline = pipelineSchema.parse(
            await live("POST", "/pipelines", initiativePipeline(run)),
          );
          pipelineId = pipeline.id;
          await note(
            `Library Pipeline "${pipeline.name}" (${pipeline.id}): ${pipeline.stages.map(({ name, kind }) => `${name} (${kind})`).join(" → ")}`,
          );

          // 4. The Office's own update check, which the Initiative must leave as it is.
          const updateBefore = await checkForUpdates(live);
          await note(`Update check before: ${updateWords(updateBefore)}`);

          // 5. Shaping: the Idea, the Initiative and Task A.
          const idea = ideaSchema.parse(
            await live("POST", "/ideas", {
              title: run.initiativeName,
              notes: "Check an Initiative with a Pipeline end to end.",
              projectId: project.id,
            }),
          );
          let initiative = initiativeSchema.parse(
            await live("POST", `/ideas/${idea.id}/initiative`),
          );
          const initiativeId = initiative.id;
          await live("PUT", `/initiatives/${initiativeId}/outcome`, {
            outcome: `${run.fileA} is added and ${README} gains a line, published together into ${throwaway}.`,
          });
          const a = taskA(run);
          const b = taskB(run);
          const taskAId = await addInitiativeTask(live, initiativeId, project, a);
          taskIds.push(taskAId);
          const ctoThread = await onlyThreadOf(live, initiativeId, "cto");
          await untilThreadWaits(live, ctoThread, ANSWER_MS);
          await note(
            `Initiative ${initiativeId} "${initiative.name}" shaping; Task A ${taskAId}; CTO's Thread ${ctoThread}`,
          );

          // 6. The CTO chooses the Pipeline straight onto the Initiative.
          const chose = await ask(
            live,
            ctoThread,
            `Please choose the library Pipeline "${pipeline.name}" (id ${pipeline.id}) as this Initiative's Pipeline in the Project ${project.name} (id ${project.id}) now, with choose_pipeline. The outcome and the Tasks are written already: change nothing else.`,
          );
          initiative = await readInitiative(live, initiativeId);
          const choosePipelineCalls = chose.messages.filter(
            (message) =>
              message.kind === "tool-activity" && message.tool.endsWith("choose_pipeline"),
          );
          const proposals = chose.messages.filter(({ kind }) => kind === "proposal");
          const hasGate = pipeline.stages.some(({ kind }) => kind === "gate");
          const chosenInProject = initiative.pipelines.find(
            ({ projectId }) => projectId === project.id,
          )?.pipelineId;
          await note(
            `CTO: ${chose.answer.replaceAll("\n", " / ")}`,
            `  choose_pipeline calls ${choosePipelineCalls.length}, Proposals ${proposals.length}; Initiative's Pipeline in the Project ${chosenInProject}, Short name ${initiative.shortName}`,
            `  the page shows ${initiative.shortName === null ? "no branch" : initiativeBranchOf(initiative.shortName)}; "publishes without your review" shown: ${!hasGate}`,
          );
          expect(choosePipelineCalls.length).toBeGreaterThan(0);
          expect(proposals).toEqual([]);
          expect(chosenInProject).toBe(pipeline.id);
          expect(initiative.shortName).toBe(run.shortName);
          expect(hasGate).toBe(true);

          // 7. Confirm makes the Initiative's branch at the freshly fetched base.
          initiative = initiativeSchema.parse(
            await live("POST", `/initiatives/${initiativeId}/confirm`),
          );
          const branchAtConfirm = await localHead(testProject, initiativeBranch);
          const remoteBranchAtConfirm = await remoteHead(testProject, REMOTE, initiativeBranch);
          await note(
            `Confirmed: ${initiative.state}; branches ${JSON.stringify(initiative.branches)}`,
            `  local ${initiativeBranch} at ${branchAtConfirm} (base ${baseAtStart}); on ${REMOTE}: ${remoteBranchAtConfirm || "none"}`,
          );
          expect(initiative.state).toBe("active");
          expect(initiative.branches).toEqual([
            expect.objectContaining({ projectId: project.id, branch: initiativeBranch }),
          ]);
          expect(branchAtConfirm).toBe(baseAtStart);
          expect(remoteBranchAtConfirm).toBe("");

          // 8. Task A, planned in the Initiative's planning Thread.
          initiative = initiativeSchema.parse(
            await live("POST", `/initiatives/${initiativeId}/planning`, { autoMode: false }),
          );
          const planningThread = initiative.planningThreadId;
          if (planningThread === null) throw new Error("Plan the Initiative opened no Thread.");
          await untilPlannerIsDone(live, planningThread, taskAId, note);
          await confirmParts(live, taskAId, a, note);

          // B joins once A is planned: Plan the Initiative plans every Task in Backlog, and B is
          // planned in a Thread of its own, from a worktree that holds A's commit.
          const taskBId = await addInitiativeTask(live, initiativeId, project, b);
          taskIds.push(taskBId);
          await note(`Task B ${taskBId} added in Backlog`);

          await live("POST", `/tasks/${taskAId}/start`);
          let task = await untilWalkStops(live, taskAId, WALK_MS);
          // 9. A's Gate shows only A's change.
          const changesAtAGate = await changesOf(live, project.id, taskAId);
          await note(
            `A: ${task.state} at ${await waitingGate(live, taskAId)}; Changes ${pathsOf(changesAtAGate).join(", ")}`,
          );
          expect(await waitingGate(live, taskAId)).toBe(GATE.key);
          expect(pathsOf(changesAtAGate)).toEqual([run.fileA]);

          // 10. A publishes into the Initiative's branch, not the base.
          await refuseUnlessThrowaway(project, testProject);
          await live("POST", `/tasks/${taskAId}/gate/continue`);
          task = await untilDone(live, taskAId, WALK_MS, note);
          await noteStages(live, taskAId, note);
          const afterA = await branchesNow(testProject, run);
          const fileAOnBranch = await fileAt(testProject, initiativeBranch, run.fileA);
          const pullRequestsAfterA = await pullRequestsFrom(testProject, [
            `office/${taskAId}`,
            initiativeBranch,
          ]);
          await note(
            `A ${task.state}: ${branchesWords(afterA)}`,
            `  ${run.fileA} on ${initiativeBranch}: ${JSON.stringify(fileAOnBranch)}; pull requests ${JSON.stringify(pullRequestsAfterA)}`,
          );
          expect(task.state).toBe("done");
          expect(afterA.initiative.local).not.toBe(baseAtStart);
          expect(afterA.initiative.remote).toBe(afterA.initiative.local);
          expect(fileAOnBranch.trim()).toBe(run.lineA);
          expect(afterA.base.remote).toBe(baseAtStart);
          expect(afterA.base.local).toBe(baseAtStart);
          expect(pullRequestsAfterA).toEqual([]);
          const aCommit = afterA.initiative.local;

          // 13, first half: B to Planning on its own, before the Initiative's Planner could take it.
          await live("POST", `/tasks/${taskBId}/planning`);
          const bThread = threadListSchema.parse(await live("GET", `/tasks/${taskBId}/threads`))[0];
          if (!bThread) throw new Error("B's Planning opened no Thread.");
          const bWorktree = join(officeData, "worktrees", project.id, taskBId);
          const bHoldsA = await isAncestor(bWorktree, aCommit, "HEAD");
          await note(
            `B in Planning, Thread ${bThread.id}; its worktree's HEAD holds A's commit ${aCommit}: ${bHoldsA}`,
          );
          expect(bHoldsA).toBe(true);

          // 11. The Initiative's planning Thread, in a fresh session, reads the branch.
          const briefs = app.get(Briefs, { strict: false });
          const threads = app.get(ThreadRepository, { strict: false });
          const initiativeBases = join(officeData, "initiative-bases", run.shortName);
          const plannerBrief = await freshBrief(briefs, threads, planningThread);
          const plannerBriefNames = {
            branch: plannerBrief.includes(initiativeBranch),
            folder: plannerBrief.includes(join(initiativeBases, project.id)),
          };
          await live("PUT", `/threads/${planningThread}/context-override`, {
            override: "start-fresh",
          });
          const plannerRead = await ask(
            live,
            planningThread,
            `Quote the one line of ${run.fileA} in ${project.name}, reading it where The Projects in your Brief say, exactly as it is written. Plan nothing now.`,
          );
          await note(
            `Initiative's Planner, ${plannerRead.move ?? "no"} session: ${plannerRead.answer.replaceAll("\n", " / ")}`,
            `  fresh Brief names ${initiativeBranch}: ${plannerBriefNames.branch}, its folder ${join(initiativeBases, project.id)}: ${plannerBriefNames.folder}`,
          );
          expect(plannerBriefNames).toEqual({ branch: true, folder: true });
          expect(plannerRead.move).toBe("fresh");
          expect(plannerRead.answer).toContain(run.lineA);

          // 12. The CTO's Thread resumes the session started while shaping, and reads the branch.
          await live("PUT", `/threads/${ctoThread}/context-override`, {
            override: "continue-anyway",
          });
          const ctoRead = await ask(
            live,
            ctoThread,
            `The Initiative is confirmed. Read the file ${run.fileA} in ${join(initiativeBases, project.id)} and quote its one line exactly as it is written. Change nothing.`,
          );
          const ctoBrief = await freshBrief(briefs, threads, ctoThread);
          await note(
            `CTO, ${ctoRead.move ?? "no"} session: ${ctoRead.answer.replaceAll("\n", " / ")}`,
            `  a fresh session's Brief names ${initiativeBranch}: ${ctoBrief.includes(initiativeBranch)}`,
          );
          expect(ctoRead.move).toBe("resume");
          expect(ctoRead.answer).toContain(run.lineA);
          expect(ctoBrief).toContain(initiativeBranch);

          // 13, second half, and 14: B's own Planner reads A's line from the worktree, then plans.
          await startPlanner(live, bThread.id, ANSWER_MS);
          await answerDecisions(live, taskBId, bThread.id);
          const bRead = await ask(
            live,
            bThread.id,
            `Quote the one line of ${run.fileA} in your worktree, exactly as it is written.`,
          );
          await note(`B's Planner: ${bRead.answer.replaceAll("\n", " / ")}`);
          expect(bRead.answer).toContain(run.lineA);
          await nudgeForPlan(live, bThread.id, taskBId);
          await confirmParts(live, taskBId, b, note);

          await live("POST", `/tasks/${taskBId}/start`);
          task = await untilWalkStops(live, taskBId, WALK_MS);
          await note(`B: ${task.state} at ${await waitingGate(live, taskBId)}`);
          expect(await waitingGate(live, taskBId)).toBe(GATE.key);

          // 15. A commit onto the base while B waits at its Gate.
          const baseCommit = await pushCommitOnto(testProject, {
            remote: REMOTE,
            branch: throwaway,
            mayPush: THROWAWAY_BRANCH,
            message: `Office check ${run.hex}: a base commit while B waits at its Gate`,
            files: [
              { path: README, text: run.baseLine, as: "appended-line" },
              { path: run.baseFile, text: run.baseLine, as: "whole-file" },
            ],
          });
          await note(`Pushed ${baseCommit} onto ${REMOTE}/${throwaway}`);

          // 16. B's Publish conflicts: Resolve, Test after Resolve, then the Publish into the branch.
          await refuseUnlessThrowaway(project, testProject);
          await live("POST", `/tasks/${taskBId}/gate/continue`);
          task = await untilDone(live, taskBId, WALK_MS, note);
          await noteStages(live, taskBId, note);
          const bStages = await stagesOf(live, taskBId);
          const lastOutcome = (key: string): string | undefined =>
            bStages.find(({ stage }) => stage.key === key)?.runs.at(-1)?.outcome?.status;
          const afterB = await branchesNow(testProject, run);
          const readmeOnBranch = await fileAt(testProject, initiativeBranch, README);
          const baseFileOnBranch = await fileAt(testProject, initiativeBranch, run.baseFile);
          const forward = await isAncestor(testProject, aCommit, initiativeBranch);
          const holdsBase = await isAncestor(testProject, baseCommit, initiativeBranch);
          await note(
            `B ${task.state}: Resolve ${lastOutcome("office:resolve")}, Test after Resolve ${lastOutcome("office:resolve-test")}, Publish ${lastOutcome("publish")}`,
            `  ${branchesWords(afterB)}; moved forward from A's ${aCommit}: ${forward}; holds the base commit: ${holdsBase}`,
            `  ${README}'s last lines on ${initiativeBranch}:`,
            ...lastLines(readmeOnBranch, 4),
          );
          expect(lastOutcome("office:resolve")).toBe("done");
          expect(lastOutcome("office:resolve-test")).toBe("done");
          expect(lastOutcome("publish")).toBe("done");
          expect(readmeOnBranch).toContain(run.lineB);
          expect(readmeOnBranch).toContain(run.baseLine);
          expect(baseFileOnBranch.trim()).toBe(run.baseLine);
          expect(forward).toBe(true);
          expect(holdsBase).toBe(true);
          expect(afterB.initiative.remote).toBe(afterB.initiative.local);
          expect(afterB.base.remote).toBe(baseCommit);
          expect(task.state).toBe("done");
          expect(
            await pullRequestsFrom(testProject, [`office/${taskBId}`, initiativeBranch]),
          ).toEqual([]);

          // 17. The Publishing Task, added once B is Done.
          const publishing = await publishingTasksOf(live, initiativeId);
          const publishingTask = publishing[0];
          initiative = await readInitiative(live, initiativeId);
          await note(
            `Publishing Tasks: ${publishing.map(({ id, title, state }) => `${id} "${title}" ${state}`).join("; ") || "none"}; Initiative ${initiative.state}`,
          );
          expect(publishing).toHaveLength(1);
          if (!publishingTask) throw new Error("No Publishing Task was added.");
          taskIds.push(publishingTask.id);
          const tasksRepository = app.get(TaskRepository, { strict: false });
          const added = (await tasksRepository.stateChangesOf(publishingTask.id))[0];
          const publishingStages = taskStagesSchema.parse(
            await live("GET", `/tasks/${publishingTask.id}/stages`),
          ).stages;
          const started = (publishingStages ?? []).some(({ runs }) => runs.length > 0);
          // Spec 2.1: "The whole change is in <base branch> by <publishing mode>", the mode in words.
          const wholeChange = publishingTask.definitionOfDone.at(-1) ?? "";
          await note(
            `  "${publishingTask.title}" in ${publishingTask.projectId}, ${publishingTask.state}, started: ${started}; Pipeline ${publishingTask.pipelineId}`,
            `  added by ${JSON.stringify(added?.by)} into ${added?.to}`,
            `  Definition of Done: ${JSON.stringify(publishingTask.definitionOfDone)}`,
            `  Files to change: ${JSON.stringify(publishingTask.filesToChange)}`,
          );
          expect(publishingTask.title).toBe(`${run.initiativeName} → ${project.name}`);
          expect(publishingTask.projectId).toBe(project.id);
          expect(publishingTask.state).toBe("ready");
          expect(started).toBe(false);
          expect(added).toMatchObject({ from: undefined, to: "ready", by: { kind: "office" } });
          expect(publishingTask.pipelineId).toBe(pipeline.id);
          expect(publishingTask.definitionOfDone.slice(0, -1).toSorted()).toEqual(
            [...a.definitionOfDone, ...b.definitionOfDone].toSorted(),
          );
          expect(wholeChange.startsWith(`The whole change is in ${throwaway} by `)).toBe(true);
          expect(wholeChange).toContain("merge");
          expect(publishingTask.filesToChange.toSorted()).toEqual([README, run.fileA].toSorted());
          expect(initiative.state).toBe("active");

          // 18. Started, Tests passes and it waits at Look with the whole change, no base commit.
          await live("POST", `/tasks/${publishingTask.id}/start`);
          task = await untilWalkStops(live, publishingTask.id, WALK_MS);
          const changesAtLook = await changesOf(live, project.id, publishingTask.id);
          await note(
            `Publishing Task: ${task.state} at ${await waitingGate(live, publishingTask.id)}; Changes ${pathsOf(changesAtLook).join(", ")}`,
          );
          expect(await waitingGate(live, publishingTask.id)).toBe(GATE.key);
          expect(pathsOf(changesAtLook).toSorted()).toEqual([README, run.fileA].toSorted());

          // 19. One more base commit while it waits, then Publish merges the whole change.
          const laterBaseCommit = await pushCommitOnto(testProject, {
            remote: REMOTE,
            branch: throwaway,
            mayPush: THROWAWAY_BRANCH,
            message: `Office check ${run.hex}: a base commit while the Publishing Task waits at its Gate`,
            files: [{ path: run.laterBaseFile, text: run.baseLine, as: "whole-file" }],
          });
          await note(`Pushed ${laterBaseCommit} onto ${REMOTE}/${throwaway}`);
          const initiativeBeforePublish = await localHead(testProject, initiativeBranch);
          await refuseUnlessThrowaway(project, testProject);
          await live("POST", `/tasks/${publishingTask.id}/gate/continue`);
          task = await untilDone(live, publishingTask.id, WALK_MS, note);
          await noteStages(live, publishingTask.id, note);
          const published = await branchesNow(testProject, run);
          await git(testProject, "fetch", REMOTE, throwaway);
          const publishedBase = `${REMOTE}/${throwaway}`;
          const parents = (
            await git(testProject, "rev-list", "--parents", "-n", "1", publishedBase)
          )
            .split(" ")
            .slice(1);
          const readmeOnBase = await fileAt(testProject, publishedBase, README);
          const fileAOnBase = await fileAt(testProject, publishedBase, run.fileA);
          const holdsEveryBaseCommit =
            (await isAncestor(testProject, baseCommit, publishedBase)) &&
            (await isAncestor(testProject, laterBaseCommit, publishedBase));
          const holdsTheBranch = await isAncestor(
            testProject,
            initiativeBeforePublish,
            publishedBase,
          );
          initiative = await readInitiative(live, initiativeId);
          await note(
            `Publishing Task ${task.state}; Initiative ${initiative.state}; ${branchesWords(published)}`,
            `  ${publishedBase} at ${published.base.remote}, parents ${parents.join(", ")}; holds every base commit: ${holdsEveryBaseCommit}; holds ${initiativeBranch} as it was (${initiativeBeforePublish}): ${holdsTheBranch}`,
            `  Initiative's branches ${JSON.stringify(initiative.branches)}`,
          );
          expect(fileAOnBase.trim()).toBe(run.lineA);
          expect(readmeOnBase).toContain(run.lineB);
          expect(holdsEveryBaseCommit).toBe(true);
          expect(holdsTheBranch).toBe(true);
          expect(parents).toHaveLength(2);
          expect(parents).toEqual(
            expect.arrayContaining([initiativeBeforePublish, laterBaseCommit]),
          );
          expect(published.base.local).toBe(published.base.remote);
          expect(published.initiative.local).toBe(published.initiative.remote);
          expect(task.state).toBe("done");
          expect(initiative.state).toBe("done");
          expect(published.initiative.local).not.toBe("");
          expect(published.initiative.remote).not.toBe("");
          expect(initiative.branches).toEqual([
            expect.objectContaining({ projectId: project.id, branch: initiativeBranch }),
          ]);

          // 20. The Office's own update check answers as it did before.
          const updateAfter = await checkForUpdates(live);
          await note(`Update check after: ${updateWords(updateAfter)}`);
          expect(updateSummary(updateAfter)).toEqual(updateSummary(updateBefore));
        } finally {
          const left = api;
          const added = pipelineId;
          pipelineRemoved =
            left === undefined || added === undefined
              ? "never added"
              : await left("DELETE", `/pipelines/${added}`).then(
                  () => "removed",
                  (error: unknown) => `not removed: ${String(error)}`,
                );
          await app?.close();
          await cleanUpTestProject(testProject, {
            base: throwaway,
            taskIds,
            initiativeBranch,
            officeData,
            remote: REMOTE,
          });
          mainAfter = {
            local: await git(testProject, "rev-parse", "main"),
            remote: await remoteHead(testProject, REMOTE, "main"),
          };
          await note(
            `Cleaned up; library Pipeline ${pipelineRemoved}; ${REMOTE} has ${throwaway}: ${(await remoteHead(testProject, REMOTE, throwaway)) !== ""}, has ${initiativeBranch}: ${(await remoteHead(testProject, REMOTE, initiativeBranch)) !== ""}`,
            `  local ${throwaway}: ${(await localHead(testProject, throwaway)) || "none"}, local ${initiativeBranch}: ${(await localHead(testProject, initiativeBranch)) || "none"}`,
            `  main ${mainAfter.local} (was ${mainBefore}), ${REMOTE}/main ${mainAfter.remote} (was ${remoteMainBefore})`,
          );
          await rm(folder, { recursive: true, force: true });
        }
        expect(mainAfter).toEqual({ local: mainBefore, remote: remoteMainBefore });
        expect(pipelineRemoved).toBe("removed");
      },
      ANSWER_MS * 12 + WALK_MS * 4,
    );
  },
);

/** A new Task in the Initiative, in its Project, with the check's notes as its Description. */
async function addInitiativeTask(
  api: Api,
  initiativeId: string,
  project: Project,
  task: InitiativeTask,
): Promise<string> {
  return taskSchema.parse(
    await api("POST", `/initiatives/${initiativeId}/tasks`, {
      title: task.title,
      description: task.description,
      projectId: project.id,
      priority: "normal",
      blockedBy: [],
    }),
  ).id;
}

async function readInitiative(api: Api, initiativeId: string): Promise<Initiative> {
  return initiativeSchema.parse(await api("GET", `/initiatives/${initiativeId}`));
}

/** The one Thread the person has on the Initiative: the CTO's shaping Thread, opened with it. */
async function onlyThreadOf(api: Api, initiativeId: string, roleKey: string): Promise<string> {
  const threads = threadListSchema
    .parse(await api("GET", `/initiatives/${initiativeId}/threads`))
    .filter((thread) => thread.roleKey === roleKey);
  const [thread] = threads;
  if (threads.length !== 1 || !thread)
    throw new Error(`The Initiative has ${threads.length} Threads with ${roleKey}, not one.`);
  return thread.id;
}

/** What one message in a Thread brought: the person's last answer and how its session started. */
interface Asked {
  readonly answer: string;
  readonly move: string | undefined;
  /** The messages logged since the user's. */
  readonly messages: readonly Message[];
}

async function ask(api: Api, threadId: string, text: string): Promise<Asked> {
  const before = messageListSchema.parse(await api("GET", `/threads/${threadId}/messages`)).length;
  await api("POST", `/threads/${threadId}/messages`, { text });
  await untilThreadWaits(api, threadId, ANSWER_MS);
  const messages = messageListSchema
    .parse(await api("GET", `/threads/${threadId}/messages`))
    .slice(before);
  const answer = messages.findLast((message) => message.kind === "person");
  const context = messages.findLast((message) => message.kind === "context");
  return {
    answer: answer?.kind === "person" ? answer.text : "",
    move: context?.kind === "context" ? context.move : undefined,
    messages,
  };
}

async function answerDecisions(api: Api, taskId: string, threadId: string): Promise<void> {
  for (const asked of await openDecisionsOn(api, taskId)) {
    await submitDecision(api, asked);
    await untilThreadWaits(api, threadId, ANSWER_MS);
  }
}

/** Waits for the Initiative's Planner to plan Task A, answering its Decisions as recommended. */
async function untilPlannerIsDone(
  api: Api,
  threadId: string,
  taskId: string,
  note: Note,
): Promise<void> {
  await untilThreadWaits(api, threadId, ANSWER_MS);
  await answerDecisions(api, taskId, threadId);
  await nudgeForPlan(api, threadId, taskId);
  const { tokens } = threadSchema.parse(await api("GET", `/threads/${threadId}`));
  await note(
    `Initiative's planning Thread ${threadId}: tokens ${tokensOf(tokens)} ${JSON.stringify(tokens)}`,
  );
}

/** Asks the Planner once more when the Task still has no Plan. */
async function nudgeForPlan(api: Api, threadId: string, taskId: string): Promise<void> {
  const task = taskSchema.parse(await api("GET", `/tasks/${taskId}`));
  if (task.state === "planning" && task.plan !== "") return;
  await api("POST", `/threads/${threadId}/messages`, {
    text: `Please write the Plan of Task ${taskId} now with write_plan, with filesToChange listing the files it changes, then mark it planned.`,
  });
  await untilThreadWaits(api, threadId, ANSWER_MS);
}

/**
 * Keeps the Planner's Plan and writes the rest as the user: the Files to change and Definition of
 * Done the check expects the Publishing Task to gather, Quick fix with a Gate before Publish, Ready.
 */
async function confirmParts(
  api: Api,
  taskId: string,
  given: InitiativeTask,
  note: Note,
): Promise<Task> {
  const planned = taskSchema.parse(await api("GET", `/tasks/${taskId}`));
  await note(
    `Task ${taskId} "${planned.title}": ${planned.state}, marked planned ${planned.markedPlanned}`,
    `  Plan: ${planned.plan.replaceAll("\n", " / ")}`,
    `  Files to change, as the Planner wrote them: ${JSON.stringify(planned.filesToChange)}`,
  );
  if (planned.state !== "planning" || planned.plan === "")
    throw new Error(`Task ${taskId} is ${planned.state} with no Plan: the Planner didn't plan it.`);
  await api("PUT", `/tasks/${taskId}/plan`, {
    plan: planned.plan,
    filesToChange: given.filesToChange,
  });
  await api("PUT", `/tasks/${taskId}/definition-of-done`, {
    definitionOfDone: given.definitionOfDone,
  });
  await api("POST", `/tasks/${taskId}/plan/confirm`);
  await api("POST", `/tasks/${taskId}/definition-of-done/confirm`);
  await api("PUT", `/tasks/${taskId}/pipeline`, { pipelineId: "quick-fix" });
  const quickFix = pipelineSchema.parse(await api("GET", "/pipelines/quick-fix"));
  const publishAt = quickFix.stages.findIndex(({ key }) => key === "publish");
  await api("PUT", `/tasks/${taskId}/stages`, {
    stages: quickFix.stages.toSpliced(publishAt, 0, GATE),
  });
  const ready = taskSchema.parse(await api("POST", `/tasks/${taskId}/ready`));
  expect(ready.state).toBe("ready");
  return ready;
}

async function noteStages(api: Api, taskId: string, note: Note): Promise<void> {
  for (const stage of await stagesOf(api, taskId)) await note(...(await stageLines(api, stage)));
}

/** The Brief a fresh session of the Thread would start on, read as the session would read it. */
async function freshBrief(
  briefs: Briefs,
  threads: ThreadRepository,
  threadId: string,
): Promise<string> {
  const thread = await threads.find(threadId);
  if (!thread) throw new Error(`There is no Thread ${threadId}.`);
  return (await briefs.forThread({ ...thread, session: undefined })).text;
}

async function publishingTasksOf(api: Api, initiativeId: string): Promise<Task[]> {
  const publishing = taskListSchema
    .parse(await api("GET", "/tasks"))
    .filter((task) => task.initiativeId === initiativeId && task.madeFor === "publishing");
  return Promise.all(
    publishing.map(async ({ id }) => taskSchema.parse(await api("GET", `/tasks/${id}`))),
  );
}

async function changesOf(api: Api, projectId: string, taskId: string): Promise<TaskChanges> {
  return taskChangesSchema.parse(
    await api("GET", `/projects/${projectId}/tasks/${taskId}/changes`),
  );
}

function pathsOf(changes: TaskChanges): string[] {
  return changes.files.map(({ path }) => path);
}

async function checkForUpdates(api: Api): Promise<OfficeUpdate> {
  return officeUpdateSchema.parse(await api("POST", "/office-update/check"));
}

/** What the update check found that the Initiative must leave alone: its behind and newest. */
function updateSummary(update: OfficeUpdate): {
  behind: string[] | undefined;
  newest: string | undefined;
} {
  return {
    behind: update.check?.behind.map(({ commit }) => commit),
    newest: update.check?.newest?.commit,
  };
}

function updateWords(update: OfficeUpdate): string {
  const { behind, newest } = updateSummary(update);
  return `behind ${behind === undefined ? "unchecked" : behind.length}, newest ${newest ?? "none"}${update.check?.problem ? `, problem: ${update.check.problem}` : ""}`;
}

/** Where the base and the Initiative's branches are, locally and on the remote. */
interface BranchHeads {
  readonly base: { readonly local: string; readonly remote: string };
  readonly initiative: { readonly local: string; readonly remote: string };
}

async function branchesNow(repositoryPath: string, run: CheckRun): Promise<BranchHeads> {
  return {
    base: {
      local: await localHead(repositoryPath, run.throwaway),
      remote: await remoteHead(repositoryPath, REMOTE, run.throwaway),
    },
    initiative: {
      local: await localHead(repositoryPath, run.initiativeBranch),
      remote: await remoteHead(repositoryPath, REMOTE, run.initiativeBranch),
    },
  };
}

function branchesWords({ base, initiative }: BranchHeads): string {
  return `base local ${base.local}, ${REMOTE} ${base.remote}; Initiative's branch local ${initiative.local}, ${REMOTE} ${initiative.remote || "none"}`;
}

/** The commit a local branch is at, or "" when there is no such branch. */
async function localHead(repositoryPath: string, branch: string): Promise<string> {
  return git(repositoryPath, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`).catch(
    () => "",
  );
}

/** A file's text at a commit or branch, or "" when it isn't there. */
async function fileAt(repositoryPath: string, revision: string, path: string): Promise<string> {
  return git(repositoryPath, "show", `${revision}:${path}`).catch(() => "");
}

async function isAncestor(folder: string, ancestor: string, of: string): Promise<boolean> {
  return git(folder, "merge-base", "--is-ancestor", ancestor, of).then(
    () => true,
    () => false,
  );
}

function lastLines(text: string, count: number): string[] {
  return text
    .trimEnd()
    .split("\n")
    .slice(-count)
    .map((line) => `  > ${line}`);
}

/** The pull requests opened from any of the branches, in any state: merge mode opens none. */
async function pullRequestsFrom(
  repositoryPath: string,
  branches: readonly string[],
): Promise<string[]> {
  const urls: string[] = [];
  for (const branch of branches) {
    const listed = JSON.parse(
      await gh(repositoryPath, "pr", "list", "--head", branch, "--state", "all", "--json", "url"),
    ) as { url: string }[];
    urls.push(...listed.map(({ url }) => url));
  }
  return urls;
}

async function gh(repositoryPath: string, ...args: string[]): Promise<string> {
  return (await runCommand("gh", args, { cwd: repositoryPath })).stdout.trim();
}

/**
 * Throws before anything is published unless the Project merges into the throwaway branch, which
 * tracks its own remote copy.
 */
async function refuseUnlessThrowaway(project: Project, repositoryPath: string): Promise<void> {
  if (["main", "master"].includes(project.baseBranch) || !THROWAWAY_BRANCH.test(project.baseBranch))
    throw new Error(`Refusing to publish into ${project.baseBranch}: not a throwaway branch.`);
  if (project.publishingMode !== "merge")
    throw new Error(`Refusing to publish in ${project.publishingMode} mode: merge only.`);
  const upstream = await git(
    repositoryPath,
    "rev-parse",
    "--abbrev-ref",
    `${project.baseBranch}@{u}`,
  );
  if (upstream !== `${REMOTE}/${project.baseBranch}`)
    throw new Error(`Refusing: ${project.baseBranch} tracks ${upstream}, not its own remote copy.`);
}

/** Pushes the throwaway base branch, checked against its pattern first: never main. */
async function pushThrowaway(repositoryPath: string, branch: string): Promise<void> {
  if (!THROWAWAY_BRANCH.test(branch)) throw new Error(`Refusing to push ${branch}.`);
  await git(repositoryPath, "push", "--set-upstream", REMOTE, branch);
}
