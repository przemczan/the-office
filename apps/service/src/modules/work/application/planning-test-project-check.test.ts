import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { INestApplication } from "@nestjs/common";
import {
  decisionListSchema,
  ideaSchema,
  messageListSchema,
  projectSchema,
  roleSchema,
  taskSchema,
  threadListSchema,
  threadSchema,
  type Message,
  type Task,
} from "@the-office/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  checkApi,
  FIRST_PLANNING_MESSAGE,
  messageLine,
  type Api,
  type ApiCall,
} from "../../../../test/live-check.js";
import { startTestApplication } from "../../../../test/test-application.js";
import { EventsModule } from "../../../platform/events/events.module.js";
import { OfficeDataModule } from "../../../platform/office-data/office-data.module.js";
import { TelemetryModule } from "../../../platform/telemetry/telemetry.module.js";
import { EventStreamModule } from "../../../platform/websocket/event-stream.module.js";
import {
  ConversationsModule,
  TaskTokens,
  DecisionService,
  ProposalService,
  ThreadService,
} from "../../conversations/index.js";
import {
  DayUsage,
  EngineModule,
  FIRST_CLAUDE_CODE_ENGINE,
  ModelPrices,
  UsageWindowSamples,
  UsageWindowState,
} from "../../engine/index.js";
import { EngineCascade, EngineCascadeModule, PeopleModule, RoleCards } from "../../people/index.js";
import {
  PipelineLibrary,
  PipelineLibraryModule,
  UsageHistory,
  UsageHistoryModule,
  StageResultWords,
} from "../../pipelines/index.js";
import {
  BaseCheckouts,
  EngineLevelsChecks,
  ProjectRecords,
  ProjectService,
  ProjectsFromRepositories,
  ProjectsModule,
  TaskWorktrees,
} from "../../projects/index.js";
import { SkillsModule } from "../../skills/index.js";
import { WorkModule } from "../work.module.js";
import { GitHubModule } from "../../github/index.js";

/**
 * Task 11's check on the Test Project (docs/tasks/11-planning.md): through the API, as the web
 * does, a small real change is planned with the Planner, on Haiku, to Ready, with a Decision
 * answered on the way. Live, so it runs only when asked: OFFICE_ENGINE_TESTS=live and
 * OFFICE_TEST_PROJECT=<the Test Project's folder>, with OFFICE_CHECK_REPORT=<a file> to keep what
 * it saw. It hires the Planner from its preset, so it runs alone, never beside
 * roles.controller.test.ts.
 */
const MODE = process.env["OFFICE_ENGINE_TESTS"];
const TEST_PROJECT = process.env["OFFICE_TEST_PROJECT"];
const REPORT = process.env["OFFICE_CHECK_REPORT"];
const ANSWER_MS = 240_000;
/** The opening, the reply, the Decision's answer, up to two nudges and the user's edit. */
const MOST_TURNS = 7;
const EDITING_TOOLS = ["Edit", "Write", "MultiEdit", "NotebookEdit"];
const PLAN_EDIT = 'The health check names the version under the key "version".';
const run = promisify(execFile);

describe.runIf(MODE === "live" && TEST_PROJECT !== undefined)(
  "Task 11's check on the Test Project",
  () => {
    it(
      "plans a small real change with the Planner to Ready, answering a Decision on the way",
      async () => {
        const testProject = TEST_PROJECT ?? "";
        const folder = await mkdtemp(join(tmpdir(), "office-planning-check-"));
        const officeData = join(folder, "office-data");
        const report: string[] = [];
        const note = async (...lines: string[]): Promise<void> => {
          report.push(...lines);
          // For the task's Progress log: vitest keeps a passing test's console to itself.
          if (REPORT) await writeFile(REPORT, `${report.join("\n")}\n`);
        };
        let app: INestApplication | undefined;
        let worktree: { path: string; branch: string } | undefined;
        try {
          const projects = ProjectsModule.register({
            imports: [PipelineLibraryModule, GitHubModule.register()],
            knownPipelines: PipelineLibrary,
          });
          const engineCascade = EngineCascadeModule.register({
            imports: [projects, PipelineLibraryModule],
            knownProjectLevels: ProjectService,
            projectLevelsSaves: EngineLevelsChecks,
          });
          const conversations = ConversationsModule.register({
            imports: [projects, engineCascade],
            projectBases: BaseCheckouts,
            projectOutputMasks: ProjectService,
            projectRecords: ProjectRecords,
          });
          let url: string;
          ({ app, url } = await startTestApplication({
            database: true,
            imports: [
              EventsModule,
              EventStreamModule,
              TelemetryModule,
              OfficeDataModule.forRoot(officeData),
              EngineModule,
              SkillsModule,
              PeopleModule,
              PipelineLibraryModule,
              projects,
              conversations,
              WorkModule.register({
                imports: [
                  projects,
                  conversations,
                  engineCascade,
                  PeopleModule,
                  PipelineLibraryModule,
                  UsageHistoryModule,
                ],
                knownProjects: ProjectService,
                newProjects: ProjectsFromRepositories,
                projectWorktrees: TaskWorktrees,
                knownPeople: RoleCards,
                knownEngineCascade: EngineCascade,
                knownPipelines: PipelineLibrary,
                sessionPeople: ThreadService,
                ideaCards: ThreadService,
                sessionTasks: ThreadService,
                sessionInitiatives: ThreadService,
                taskThreads: ThreadService,
                initiativeThreads: ThreadService,
                taskDecisions: DecisionService,
                proposalDrafts: ProposalService,
                usageHistory: UsageHistory,
                stageResults: StageResultWords,
                modelPrices: ModelPrices,
                accountWindows: UsageWindowState,
                accountWindowRatios: UsageWindowSamples,
                dayUsage: DayUsage,
                taskTokens: TaskTokens,
              }),
            ],
          }));
          const { call, api } = checkApi(url);

          // The Planner from its preset, on Haiku at low effort: the cheapest that proves the point.
          const hired = roleSchema.parse(
            await api("POST", "/roles", { roleKey: "planner", name: "Jan" }),
          );
          await api("PUT", "/roles/planner/card", {
            ...hired.card,
            roleOverride: { engineId: FIRST_CLAUDE_CODE_ENGINE.id, model: "claude-haiku-5-5" },
            effort: "low",
            skills: [],
          });
          const project = projectSchema.parse(
            await api("POST", "/projects", {
              name: "notnullsoft-admin",
              path: testProject,
              baseBranch: "main",
              mark: { label: "NA", colour: "teal" },
              commands: {
                install: "npm install",
                build: "npm run build",
                lint: "npm run lint",
                test: "npm test",
              },
              installInputs: ["package-lock.json"],
              publishingMode: "push-and-pull-request",
              defaultPipeline: "full",
            }),
          );

          // A small real change with a fork in it, shaped from an Idea, a document attached.
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
          const upload = await fetch(
            `${url}/api/tasks/${shaped.id}/attachments/files?fileName=health-version.md&mediaType=text/markdown`,
            {
              method: "POST",
              headers: { "Content-Type": "application/octet-stream" },
              body: "# Health check\n\nThe deploy job knows the commit it deploys.\n",
            },
          );
          expect(upload.status).toBe(201);
          const attachment = (await upload.json()) as { id: string; name: string };

          // Plan with Jan: the Task's branch and worktree at the freshly fetched base.
          const planning = taskSchema.parse(await api("POST", `/tasks/${shaped.id}/planning`));
          expect(planning.state).toBe("planning");
          worktree = {
            path: join(officeData, "worktrees", project.id, shaped.id),
            branch: `office/${shaped.id}`,
          };
          const base = await freshBaseOf(testProject);
          const head = await git(worktree.path, "rev-parse", "HEAD");
          expect(await git(worktree.path, "rev-parse", "--abbrev-ref", "HEAD")).toBe(
            worktree.branch,
          );
          expect(head).toBe(base.commit);
          await note(
            `Task ${shaped.id} "${shaped.title}" (from Idea ${idea.id}) in ${planning.state}`,
            `Worktree ${worktree.path} on ${worktree.branch} at ${head}, ${base.ref} after the fetch`,
          );

          const thread = threadListSchema.parse(await api("GET", `/tasks/${shaped.id}/threads`))[0];
          if (!thread) throw new Error("Planning opened no Thread.");
          await note(`Thread ${thread.id} "${thread.title}" with ${thread.roleKey}`);

          // Mark Ready, tried early: nothing is written yet.
          await note(`Mark Ready, early: ${await refusedReady(call, shaped.id)}`);

          const log = threadLog(api, thread.id, note);
          let turns = 0;
          const turn = async (said: string | undefined, label: string): Promise<Message[]> => {
            turns += 1;
            expect(turns).toBeLessThanOrEqual(MOST_TURNS);
            if (said !== undefined) {
              await api("POST", `/threads/${thread.id}/messages`, { text: said });
            }
            await untilWaiting(api, thread.id);
            return log.since(label, said);
          };

          // The Planner starts on the user's first message (spec 2.1).
          await turn(FIRST_PLANNING_MESSAGE, "The user's first message");

          // The Brief, as the Thread's first session read it.
          const brief = await firstSessionMessage(shaped.id);
          await note(
            "The first session's first message (the Brief and the user's message):",
            brief,
          );
          expect(brief).toContain(shaped.title);
          expect(brief).toContain(idea.notes);
          expect(brief).toContain(`Attachment ${attachment.id}`);
          expect(brief).toContain("npm run build");

          // The fork is the user's: Jan opens a Decision on it.
          await turn(
            "It's the server's GET /api/health. Where the version comes from is my call: open a Decision on it with open_decision, with the options you see and the one you recommend.",
            "The user's reply",
          );
          let decision = await openDecisionOn(api, shaped.id);
          if (!decision) {
            await turn("Please open that Decision now, with open_decision.", "Nudge: Decision");
            decision = await openDecisionOn(api, shaped.id);
          }
          if (!decision) throw new Error("Jan opened no Decision.");
          await note(
            `Waiting on you: the open Decisions name the Task ${decision.taskId} (${decision.question})`,
          );
          expect(threadSchema.parse(await api("GET", `/threads/${thread.id}`)).state).toBe(
            "waiting",
          );

          // Answered by the option Jan recommends, into the same session.
          await api("POST", `/decisions/${decision.id}/answer`, {
            kind: "option",
            option: decision.recommendation.option,
          });
          await turn(
            undefined,
            `The answer: "${decision.options[decision.recommendation.option]}"`,
          );
          await expect(openDecisionOn(api, shaped.id)).resolves.toBeUndefined();

          let task = await taskOf(api, shaped.id);
          const missing = missingParts(task);
          if (missing.length > 0) {
            await turn(
              `Thanks. Now write ${missing.join(", ")} onto the Task.`,
              "Nudge: the three parts",
            );
            task = await taskOf(api, shaped.id);
          }
          expect(missingParts(task)).toEqual([]);
          await note(...partsOf(task, "Written by Jan"));
          await note(`Mark Ready, proposed only: ${await refusedReady(call, shaped.id)}`);

          // The user's edit, then a message: does Jan read the Task before touching the parts?
          await api("PUT", `/tasks/${shaped.id}/plan`, { plan: `${task.plan}\n\n${PLAN_EDIT}` });
          const afterEdit = await turn(
            "I edited the Plan on the Task. Bring the Definition of Done in line with it, and leave the Plan as it is.",
            "After the user's edit of the Plan",
          );
          task = await taskOf(api, shaped.id);
          const readTheTask = afterEdit.some(
            (message) => message.kind === "tool-activity" && message.tool.endsWith("read_task"),
          );
          await note(
            `Jan read the Task after the edit: ${readTheTask}; the edit kept: ${task.plan.includes(PLAN_EDIT)}; Plan ${task.planConfirmed ? "confirmed" : "proposed"}`,
            ...partsOf(task, "After the edit"),
          );

          // The user confirms what is shown and marks the Task Ready.
          const proposal = task.proposedPipeline;
          if (!proposal) throw new Error("No Pipeline is proposed any more.");
          await api("POST", `/tasks/${shaped.id}/plan/confirm`);
          await api("POST", `/tasks/${shaped.id}/definition-of-done/confirm`);
          await api("PUT", `/tasks/${shaped.id}/pipeline`, { pipelineId: proposal.pipelineId });
          const ready = taskSchema.parse(await api("POST", `/tasks/${shaped.id}/ready`));
          expect(ready).toMatchObject({
            state: "ready",
            planConfirmed: true,
            definitionOfDoneConfirmed: true,
            pipelineId: proposal.pipelineId,
            proposedPipeline: null,
          });
          await note(`Ready on ${ready.pipelineId}`);

          // The context labels and tokens, and that Jan changed nothing.
          const messages = messageListSchema.parse(
            await api("GET", `/threads/${thread.id}/messages`),
          );
          const answered = threadSchema.parse(await api("GET", `/threads/${thread.id}`));
          const tokens = Object.values(answered.tokens).reduce((sum, part) => sum + part, 0);
          await note(
            "Context labels:",
            ...messages.flatMap((message) =>
              message.kind === "context" ? [`  ${messageLine(message)}`] : [],
            ),
            `Thread tokens ${tokens} ${JSON.stringify(answered.tokens)}, context ${answered.context.contextTokens}`,
            `Failures: ${messages.filter(({ kind }) => kind === "failure").length}, refusals: ${messages
              .flatMap((message) => (message.kind === "refusal" ? [message.tool] : []))
              .join(", ")}`,
          );
          expect(messages.filter(({ kind }) => kind === "failure")).toEqual([]);
          const edits = messages.filter(
            (message) => message.kind === "tool-activity" && EDITING_TOOLS.includes(message.tool),
          );
          expect(edits).toEqual([]);
          await expect(git(worktree.path, "status", "--porcelain")).resolves.toBe("");
          await expect(git(worktree.path, "rev-list", `${base.commit}..HEAD`)).resolves.toBe("");
          await expect(git(testProject, "status", "--porcelain")).resolves.toBe("");
          await expect(readdir(join(officeData, "attachments"))).resolves.toHaveLength(1);
        } finally {
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
      (MOST_TURNS + 1) * ANSWER_MS,
    );
  },
);

async function git(folder: string, ...args: string[]): Promise<string> {
  return (await run("git", args, { cwd: folder })).stdout.trim();
}

/** The commit planning starts from: the base branch's upstream once fetched, or the branch. */
async function freshBaseOf(
  testProject: string,
): Promise<{ readonly ref: string; readonly commit: string }> {
  const upstream = await git(testProject, "rev-parse", "--abbrev-ref", "main@{upstream}").catch(
    () => undefined,
  );
  const ref = upstream ?? "main";
  return { ref, commit: await git(testProject, "rev-parse", ref) };
}

async function untilWaiting(api: Api, threadId: string): Promise<void> {
  await vi.waitFor(
    async () => {
      const current = threadSchema.parse(await api("GET", `/threads/${threadId}`));
      if (current.state !== "waiting") throw new Error("Still answering.");
    },
    { timeout: ANSWER_MS, interval: 1_000 },
  );
}

/** Mark Ready, expected refused: its reasons. */
async function refusedReady(call: ApiCall, taskId: string): Promise<string> {
  const response = await call("POST", `/tasks/${taskId}/ready`);
  expect(response.status).toBe(422);
  const { reasons } = (await response.json()) as { reasons: string[] };
  expect(reasons.length).toBeGreaterThan(0);
  return reasons.join(" ");
}

async function taskOf(api: Api, taskId: string): Promise<Task> {
  return taskSchema.parse(await api("GET", `/tasks/${taskId}`));
}

async function openDecisionOn(api: Api, taskId: string) {
  const open = decisionListSchema.parse(await api("GET", "/decisions/open"));
  return open.find((decision) => decision.taskId === taskId);
}

/** The parts the Planner writes that aren't on the Task yet, in the tools' words. */
function missingParts(task: Task): string[] {
  return [
    task.plan === "" ? "the Plan with write_plan" : undefined,
    task.definitionOfDone.length === 0
      ? "the Definition of Done with write_definition_of_done"
      : undefined,
    task.proposedPipeline === null ? "the Pipeline you propose with propose_pipeline" : undefined,
  ].filter((part) => part !== undefined);
}

function partsOf(task: Task, heading: string): string[] {
  return [
    `${heading}:`,
    `  Plan (${task.planConfirmed ? "confirmed" : "proposed"}): ${task.plan.replaceAll("\n", " / ")}`,
    `  Definition of Done (${task.definitionOfDoneConfirmed ? "confirmed" : "proposed"}): ${task.definitionOfDone.join(" | ")}`,
    `  Pipeline ${task.pipelineId}, proposed ${JSON.stringify(task.proposedPipeline)}`,
  ];
}

/** The Thread's log, read a turn at a time into the report. */
function threadLog(api: Api, threadId: string, note: (...lines: string[]) => Promise<void>) {
  let seen = 0;
  return {
    async since(label: string, said: string | undefined): Promise<Message[]> {
      const messages = messageListSchema.parse(await api("GET", `/threads/${threadId}/messages`));
      const fresh = messages.slice(seen);
      seen = messages.length;
      await note(
        `## ${label}`,
        ...(said === undefined ? [] : [`> ${said}`]),
        ...fresh.map((message) => `  ${messageLine(message)}`),
      );
      return fresh;
    },
  };
}

/**
 * The first message of the Thread's first session, from the engine's own transcript: Claude Code
 * keeps it under ~/.claude/projects, in a folder named after the session's folder, the worktree.
 */
async function firstSessionMessage(taskId: string): Promise<string> {
  const projectsFolder = join(homedir(), ".claude", "projects");
  const folder = (await readdir(projectsFolder)).find((name) => name.endsWith(taskId));
  if (!folder) throw new Error(`No engine transcript for the worktree of Task ${taskId}.`);
  const transcripts = (await readdir(join(projectsFolder, folder))).filter((name) =>
    name.endsWith(".jsonl"),
  );
  expect(transcripts).toHaveLength(1);
  const lines = (await readFile(join(projectsFolder, folder, transcripts[0] ?? ""), "utf8"))
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as TranscriptEntry);
  const first = lines.find((entry) => entry.type === "user");
  const content = first?.message?.content;
  if (typeof content === "string") return content;
  return (content ?? []).map((block) => block.text ?? "").join("");
}

interface TranscriptEntry {
  readonly type: string;
  readonly message?: { readonly content: string | readonly { readonly text?: string }[] };
}
