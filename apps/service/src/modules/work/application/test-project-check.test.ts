import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { INestApplication } from "@nestjs/common";
import {
  attachmentListSchema,
  ideaSchema,
  messageListSchema,
  projectSchema,
  roleSchema,
  taskListSchema,
  taskSchema,
  threadSchema,
  type Message,
} from "@the-office/contracts";
import { describe, expect, it, vi } from "vitest";
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
  TaskGateRuns,
} from "../../pipelines/index.js";
import {
  BaseCheckouts,
  EngineLevelsChecks,
  ProjectRecords,
  ProjectService,
  ProjectsFromRepositories,
  ProjectsModule,
  InitiativeBranches,
  TaskWorktrees,
} from "../../projects/index.js";
import { SkillsModule } from "../../skills/index.js";
import { WorkModule } from "../work.module.js";
import { GitHubModule } from "../../github/index.js";

/**
 * Task 10's check on the Test Project (docs/tasks/10-work.md): through the API, as the web does,
 * an Idea is captured and shaped into a Task, a document is attached, the board is reordered, and
 * the Planner, on Haiku, reads that Task, captures an Idea and creates a Task in a real chat
 * session. Live, so it runs only when asked: OFFICE_ENGINE_TESTS=live and
 * OFFICE_TEST_PROJECT=<the Test Project's folder>, with OFFICE_CHECK_REPORT=<a file> to keep what
 * it saw. It hires the Planner from its preset, so it runs alone, never beside
 * roles.controller.test.ts.
 */
const MODE = process.env["OFFICE_ENGINE_TESTS"];
const TEST_PROJECT = process.env["OFFICE_TEST_PROJECT"];
const REPORT = process.env["OFFICE_CHECK_REPORT"];
const ANSWER_MS = 240_000;
const run = promisify(execFile);

describe.runIf(MODE === "live" && TEST_PROJECT !== undefined)(
  "Task 10's check on the Test Project",
  () => {
    it(
      "shapes an Idea into a Task with a document, reorders the board, and the Planner works Work's records in chat",
      async () => {
        const testProject = TEST_PROJECT ?? "";
        const folder = await mkdtemp(join(tmpdir(), "office-work-check-"));
        const officeData = join(folder, "office-data");
        const report: string[] = [];
        const note = async (...lines: string[]): Promise<void> => {
          report.push(...lines);
          // For the task's Progress log: vitest keeps a passing test's console to itself.
          if (REPORT) await writeFile(REPORT, `${report.join("\n")}\n`);
        };
        let app: INestApplication | undefined;
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
                projectInitiativeBranches: InitiativeBranches,
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
                taskGates: TaskGateRuns,
                modelPrices: ModelPrices,
                accountWindows: UsageWindowState,
                accountWindowRatios: UsageWindowSamples,
                dayUsage: DayUsage,
                taskTokens: TaskTokens,
              }),
            ],
          }));
          const api = async (method: string, path: string, body?: unknown): Promise<unknown> => {
            const response = await fetch(`${url}/api${path}`, {
              method,
              ...(body !== undefined && {
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
              }),
            });
            const text = await response.text();
            if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${text}`);
            return text === "" ? undefined : JSON.parse(text);
          };

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
              installCommand: "npm install",
              commands: [
                { key: "build", name: "Build", kind: "build", commandLine: "npm run build" },
                { key: "lint", name: "Lint", kind: "lint", commandLine: "npm run lint" },
                { key: "test", name: "Test", kind: "test", commandLine: "npm test" },
              ],
              installInputs: ["package-lock.json"],
              publishingMode: "push-and-pull-request",
              defaultPipeline: "full",
            }),
          );

          // Captured, shaped into a Task, a document attached.
          const idea = ideaSchema.parse(
            await api("POST", "/ideas", {
              title: "Show the build number in the footer",
              notes: "So a bug report says which build it came from.",
              projectId: project.id,
            }),
          );
          const shaped = taskSchema.parse(
            await api("POST", `/ideas/${idea.id}/shape`, { projectId: project.id }),
          );
          const upload = await fetch(
            `${url}/api/tasks/${shaped.id}/attachments/files?fileName=build-number.md&mediaType=text/markdown`,
            {
              method: "POST",
              headers: { "Content-Type": "application/octet-stream" },
              body: "# Build number\n\nRead it from the CI's environment at build time.\n",
            },
          );
          expect(upload.status).toBe(201);
          const attachments = attachmentListSchema.parse(
            await api("GET", `/tasks/${shaped.id}/attachments`),
          );
          await note(
            `Idea ${idea.id} "${idea.title}" shaped into Task ${shaped.id}: ${shaped.state}, Pipeline ${shaped.pipelineId}, origin ${shaped.originIdeaId}`,
            `Attachments: ${attachments.map(({ name, kind }) => `${name} (${kind})`).join(", ")}`,
          );

          // A second Task by the user, dragged above the first.
          const second = taskSchema.parse(
            await api("POST", "/tasks", {
              title: "Rename the settings page",
              projectId: project.id,
              priority: "normal",
            }),
          );
          const boardBefore = await boardOf(api, project.id);
          await api("PUT", `/tasks/${second.id}/place`, { above: null, below: shaped.id });
          const boardAfter = await boardOf(api, project.id);
          await note(
            `Board before: ${boardBefore.join(" | ")}`,
            `Board after: ${boardAfter.join(" | ")}`,
          );
          expect(boardAfter).toEqual([
            "Rename the settings page",
            "Show the build number in the footer",
          ]);

          // The Planner, in a real chat session, through Work's Office tools.
          const thread = threadSchema.parse(await api("POST", "/chats/planner/threads"));
          const said = [
            "Use your Office tools for each of these, then reply in three short lines:",
            `1. Find the Task "Show the build number in the footer" and tell me the name of its Attachment.`,
            `2. Capture an Idea "Dark mode for the admin panel" in the ${project.id} Project.`,
            `3. Create a Task "Add a health check endpoint" in Backlog in the ${project.id} Project.`,
          ].join("\n");
          await api("POST", `/threads/${thread.id}/messages`, { text: said });
          await vi.waitFor(
            async () => {
              const current = threadSchema.parse(await api("GET", `/threads/${thread.id}`));
              if (current.state !== "waiting") throw new Error("Still answering.");
            },
            { timeout: ANSWER_MS, interval: 1_000 },
          );
          const log = messageListSchema.parse(await api("GET", `/threads/${thread.id}/messages`));
          const answered = threadSchema.parse(await api("GET", `/threads/${thread.id}`));
          await note(
            `> ${said.replaceAll("\n", " / ")}`,
            ...log.map((message: Message) => `  ${JSON.stringify(message)}`),
            `  Thread tokens ${Object.values(answered.tokens).reduce((sum, part) => sum + part, 0)}`,
          );

          const tools = log.flatMap((message) =>
            message.kind === "tool-activity" ? [message.tool] : [],
          );
          expect(tools.some((tool) => tool.endsWith("capture_idea"))).toBe(true);
          expect(tools.some((tool) => tool.endsWith("create_task"))).toBe(true);
          expect(tools.some((tool) => /(read|list)_task/.test(tool))).toBe(true);
          const tasks = taskListSchema.parse(await api("GET", "/tasks"));
          const created = tasks.find(({ title }) => title === "Add a health check endpoint");
          expect(created).toMatchObject({
            projectId: project.id,
            state: "backlog",
            createdBy: { kind: "person", roleKey: "planner" },
          });
          const ideas = (await api("GET", "/ideas")) as { title: string; capturedBy: unknown }[];
          expect(
            ideas.find(({ title }) => title === "Dark mode for the admin panel"),
          ).toMatchObject({
            capturedBy: { kind: "person", roleKey: "planner" },
          });
          expect(log.at(-1)?.kind).toBe("person");
          await note(`Created: ${JSON.stringify(created)}`);
          await expect(readdir(join(officeData, "attachments"))).resolves.toHaveLength(1);
          await expect(
            run("git", ["status", "--porcelain"], { cwd: testProject }),
          ).resolves.toMatchObject({ stdout: "" });
        } finally {
          await app?.close();
          await run(
            "git",
            ["worktree", "remove", "--force", join(officeData, "bases", "notnullsoft-admin")],
            {
              cwd: testProject,
            },
          ).catch(() => undefined);
          await run("git", ["worktree", "prune"], { cwd: testProject }).catch(() => undefined);
          await rm(folder, { recursive: true, force: true });
        }
      },
      2 * ANSWER_MS,
    );
  },
);

/** The Project's Tasks as the board shows them, by title. */
async function boardOf(
  api: (method: string, path: string) => Promise<unknown>,
  projectId: string,
): Promise<string[]> {
  return taskListSchema
    .parse(await api("GET", "/tasks"))
    .filter((task) => task.projectId === projectId)
    .map(({ title }) => title);
}
