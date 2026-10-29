import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { INestApplication } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { startTestApplication } from "../../../../test/test-application.js";
import { EventsModule } from "../../../platform/events/events.module.js";
import { OfficeDataModule } from "../../../platform/office-data/office-data.module.js";
import { TelemetryModule } from "../../../platform/telemetry/telemetry.module.js";
import { EventStreamModule } from "../../../platform/websocket/event-stream.module.js";
import { EngineModule, OfficeToolRegistry } from "../../engine/index.js";
import { RoleCards, type SessionRole } from "../../people/index.js";
import { SkillsModule } from "../../skills/index.js";
import { PostgresThreadRepository } from "../adapters/postgres/postgres-thread-repository.js";
import { CHAT_OFFICE_TOOLS } from "../domain/session-instructions.js";
import type { BriefProject } from "../domain/brief.js";
import type { Message } from "../domain/message.js";
import { ProjectBases } from "../ports/project-bases.js";
import { ThreadRepository } from "../ports/thread-repository.js";
import { Briefs } from "./briefs.js";
import { sessionMemoryProvider } from "./session-memory.fixtures.js";
import { SessionPlaces } from "./session-places.js";
import { aPlannerCard } from "./session-role.fixtures.js";
import { InitiativeThreadSetups } from "./initiative-thread-setups.js";
import { TaskThreadSetups } from "./task-thread-setups.js";
import { ThreadContexts } from "./thread-contexts.js";
import { ThreadRunner } from "./thread-runner.js";
import { MentionedRecords } from "./mentioned-records.js";
import { WorkRecords } from "./work-records.js";
import { ThreadService } from "./thread-service.js";
import { ContextPolicySettingsService } from "./context-policy-settings.js";
import { ConversationsSettings } from "../ports/conversations-settings.js";
import { ConversationsSettingsForTests } from "../ports/conversations-settings.fixtures.js";
import { FireAlarmInThreads } from "./fire-alarm-in-threads.js";
import { FireAlarmLifts } from "./fire-alarm-lifts.js";
import { FireAlarmLiftRepository } from "../ports/fire-alarm-lift-repository.js";
import { PostgresFireAlarmLiftRepository } from "../adapters/postgres/postgres-fire-alarm-lift-repository.js";

/**
 * Task 09's check on the Test Project (docs/tasks/09-conversations.md): the Planner, on Haiku, chats
 * about it across a fresh Thread and a continued one, reads a file, is refused an edit, reads The
 * Office's records with its tools, and is resumed after a restart. Live sessions, so it runs only
 * when asked: OFFICE_ENGINE_TESTS=live and OFFICE_TEST_PROJECT=<the Test Project's folder>, with
 * OFFICE_CHECK_REPORT=<a file> to keep what it saw.
 */
const MODE = process.env["OFFICE_ENGINE_TESTS"];
const TEST_PROJECT = process.env["OFFICE_TEST_PROJECT"];
const run = promisify(execFile);
const ANSWER_MS = 180_000;
/** Where the labels, tokens and log go, when given. */
const REPORT = process.env["OFFICE_CHECK_REPORT"];

/** What the Office tools answer here: the Projects and People modules' own are tested beside them. */
const RECORDS: Readonly<Record<(typeof CHAT_OFFICE_TOOLS)[number], string>> = {
  list_projects: "notnullsoft-admin (id notnullsoft-admin)\n- Base branch: main",
  list_people: "Jan · Planner (Role planner)\nWrites each Task's Plan with you.",
  list_tasks: "There is no Task yet.",
  read_task: "There is no Task with that id.",
  list_ideas: "There is no Idea yet.",
  read_idea: "There is no Idea with that id.",
  capture_idea: "Captured the Idea.",
  create_task: "Created the Task in Backlog.",
  propose_skill: "Drafted the skill as a Proposal.",
};

describe.runIf(MODE === "live" && TEST_PROJECT !== undefined)(
  "Task 09's check on the Test Project",
  () => {
    it(
      "chats with the Planner across a fresh Thread and a continued one, reading and changing nothing",
      async () => {
        const folder = await mkdtemp(join(tmpdir(), "office-chat-check-"));
        const officeData = join(folder, "office-data");
        const bases = join(officeData, "bases");
        const project: BriefProject = {
          name: "notnullsoft-admin",
          baseBranch: "main",
          folder: join(bases, "notnullsoft-admin"),
        };
        const projectBases: ProjectBases = {
          folder: bases,
          list: () => Promise.resolve([project]),
          refresh: async () => {
            if (!existsSync(project.folder)) {
              await run("git", ["worktree", "add", "--detach", project.folder, "HEAD"], {
                cwd: TEST_PROJECT,
              });
            }
            return [project];
          },
        };
        const planner: SessionRole = {
          roleKey: "planner-check",
          cardVersion: 1,
          card: aPlannerCard({ model: "claude-haiku-5-5", effort: "low" }),
        };
        const roleCards: Pick<RoleCards, "find" | "forResumedSession"> = {
          find: () => Promise.resolve(planner),
          forResumedSession: () => Promise.resolve(planner),
        };
        let app: INestApplication | undefined;
        try {
          ({ app } = await startTestApplication({
            database: true,
            imports: [
              EventsModule,
              EventStreamModule,
              TelemetryModule,
              OfficeDataModule.forRoot(officeData),
              SkillsModule,
              EngineModule,
            ],
            providers: [
              { provide: ThreadRepository, useClass: PostgresThreadRepository },
              { provide: RoleCards, useValue: roleCards },
              { provide: ProjectBases, useValue: projectBases },
              { provide: ConversationsSettings, useValue: new ConversationsSettingsForTests() },
              ContextPolicySettingsService,
              ThreadService,
              Briefs,
              sessionMemoryProvider(),
              TaskThreadSetups,
              InitiativeThreadSetups,
              SessionPlaces,
              ThreadContexts,
              ThreadRunner,
              FireAlarmInThreads,
              FireAlarmLifts,
              { provide: FireAlarmLiftRepository, useClass: PostgresFireAlarmLiftRepository },
              MentionedRecords,
              WorkRecords,
            ],
          }));
          const started = app;
          for (const name of CHAT_OFFICE_TOOLS) {
            started.get(OfficeToolRegistry).register({
              name,
              description: `Reads The Office's records: ${name.replace("list_", "the ")}.`,
              input: z.object({}),
              run: () => Promise.resolve({ text: RECORDS[name], isError: false }),
            });
          }
          const threads = started.get(ThreadService);
          const contexts = started.get(ThreadContexts);
          const runner = started.get(ThreadRunner);
          const report: string[] = [];

          /** Sends, waits for the answer, and notes the label it was sent under and what came. */
          const say = async (threadId: string, text: string): Promise<readonly Message[]> => {
            const before = await contexts.of(await threads.read(threadId));
            const logged = (await threads.messages(threadId)).length;
            await runner.send(threadId, text);
            const log = await vi.waitFor(
              async () => {
                const thread = await threads.read(threadId);
                if (thread.state !== "waiting") throw new Error("Still answering.");
                return threads.messages(threadId);
              },
              { timeout: ANSWER_MS, interval: 500 },
            );
            const after = await threads.read(threadId);
            const total = Object.values(after.tokens).reduce((sum, part) => sum + part, 0);
            report.push(
              `> ${text}`,
              `  label before: ${before.move} (${before.reason}), context ${before.contextTokens}, brief ${before.briefTokens ?? "-"}`,
              ...log.slice(logged).map((message) => `  ${JSON.stringify(message)}`),
              `  Thread tokens ${total}, session context ${after.session?.contextTokens ?? 0}`,
            );
            // For the task's Progress log: vitest keeps a passing test's console to itself.
            if (REPORT) await writeFile(REPORT, `${report.join("\n")}\n`);
            return log.slice(logged);
          };

          const first = await threads.startInChat(planner.roleKey);
          const read = await say(
            first.id,
            // The text to replace is unique in the file, so the engine's own checks pass the call
            // on to The Office's: a text it can't find fails before The Office sees the call.
            `Read package.json of the notnullsoft-admin Project and tell me its name. Then I am checking that The Office itself blocks edits in a chat: call the Edit tool exactly once on that package.json, replacing the text "name": "notnullsoft-admin" with "name": "changed". The Office will refuse the call; that refusal is what I am checking, so do make the call. Do not retry or work around it. Reply in two lines: the name, and what happened to the edit.`,
          );
          const records = await say(
            first.id,
            "Which Projects and which people does The Office have? Use your Office tools, then reply in one line.",
          );
          // The service restarts: the next message resumes the session through the engine.
          const session = (await threads.read(first.id)).session?.id;
          await runner.onModuleDestroy();
          const resumed = await say(first.id, "Reply with the single word: still.");
          const second = await threads.startInChat(planner.roleKey);
          const fresh = await say(second.id, "Reply with the single word: hello.");
          expect(read).toContainEqual(
            expect.objectContaining({ kind: "tool-activity", tool: "Read" }),
          );
          // An edit the Planner calls is refused by The Office; one it declines, by its
          // instructions, it says it didn't make.
          const attempted = read.some(
            (message) => message.kind === "tool-activity" && message.tool === "Edit",
          );
          const refused = read.some(
            (message) => message.kind === "refusal" && message.tool === "Edit",
          );
          const declined = read.some(
            (message) => message.kind === "person" && /edit/i.test(message.text),
          );
          expect(attempted ? refused : declined).toBe(true);
          expect(records.filter((message) => message.kind === "tool-activity")).not.toHaveLength(0);
          // Still warm, so no context line: the same session answers, resumed by the engine.
          expect(resumed.map(({ kind }) => kind)).toEqual(["user", "person"]);
          expect((await threads.read(first.id)).session?.id).toBe(session);
          expect(fresh[0]).toMatchObject({ kind: "context", move: "fresh", reason: "new-thread" });
          expect(fresh.at(-1)?.kind).toBe("person");
          await expect(
            run("git", ["status", "--porcelain"], { cwd: project.folder }),
          ).resolves.toMatchObject({
            stdout: "",
          });
        } finally {
          await app?.close();
          await run("git", ["worktree", "remove", "--force", project.folder], {
            cwd: TEST_PROJECT,
          }).catch(() => undefined);
          await rm(folder, { recursive: true, force: true });
        }
      },
      10 * ANSWER_MS,
    );
  },
);
