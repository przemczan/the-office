import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { INestApplication } from "@nestjs/common";
import {
  engineAccountSchema,
  engineSettingsSchema,
  ideaSchema,
  messageListSchema,
  pipelineSchema,
  roleSchema,
  taskSchema,
  threadSchema,
  type Stage,
} from "@the-office/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addTestProject,
  checkApi,
  cleanUpTestProject,
  git,
  hireOnHaiku,
  messageLine,
  stageLines,
  stagesOf,
  untilThreadWaits,
  untilWalkStops,
  type Api,
} from "../../../../test/live-check.js";
import { startTestApplication } from "../../../../test/test-application.js";
import { testDatabaseUrl } from "../../../../test/test-database.js";
import { AppModule } from "../../../app.module.js";
import { GITHUB_SITE } from "../../../platform/git-identity/github-site.js";

/**
 * Task 50's check on the Test Project (docs/tasks/50-office-instructions.md, step 6): a line only
 * the Office instructions hold, obeyed on Claude Code by the Developer on Haiku at low effort, in
 * one chat turn and in one Agent Stage that changes no file. The Stage's Task is on Quick fix
 * without Tests and with a Gate before Publish, and is dropped at the Gate, so nothing is published.
 *
 * Live, so it runs only with OFFICE_ENGINE_TESTS=live and OFFICE_TEST_PROJECT=<the Test Project's
 * folder>, with OFFICE_CHECK_REPORT=<a file> to keep what it saw; `-t` picks one test. Each test's
 * Office data folder is new, so its engine has no login: OFFICE_CHECK_ENGINE_TOKEN=<a token from
 * `claude setup-token`> signs it in, as Settings › Engines' "Paste a token instead" does. Signed
 * out, a test fails before its session starts, which costs no quota. Both tests share one Office:
 * it hires the Planner and the Developer from their presets, so it runs alone.
 */
const MODE = process.env["OFFICE_ENGINE_TESTS"];
const TEST_PROJECT = process.env["OFFICE_TEST_PROJECT"] ?? "";
const REPORT = process.env["OFFICE_CHECK_REPORT"];
const ENGINE_TOKEN = process.env["OFFICE_CHECK_ENGINE_TOKEN"];
// Sessions inherit the service's variables, and this one is not among those they are kept from.
delete process.env["OFFICE_CHECK_ENGINE_TOKEN"];
const WEB_APP = fileURLToPath(new URL("../../../../../web", import.meta.url));
const REPLY_MS = 240_000;
/** The install before the Stage takes the longest. */
const WALK_MS = 15 * 60_000;

/** A word no model writes unprompted, and that nothing but the Office instructions holds. */
const MARK = "quokka-7421";
const OFFICE_INSTRUCTIONS = `End every reply you write, and every Stage result's summary, with the exact word ${MARK}.`;
const QUESTION = "What is the capital of France? Reply in one short sentence.";
const PLAN =
  "Read no file, change no file and run no command: this Task only checks that a Stage runs. End the Stage as done at once.";
const DEFINITION_OF_DONE = ["No file is changed."];

/** In place of Tests, so the Task stops before anything is published. */
const GATE: Stage = { kind: "gate", key: "look", name: "Look", optional: false };

const report: string[] = [];
const begun = Date.now();
let scratch: string;
let officeData: string;
let app: INestApplication | undefined;

async function note(...lines: string[]): Promise<void> {
  const seconds = Math.round((Date.now() - begun) / 1000);
  report.push(...lines.map((line, i) => (i === 0 ? `[${seconds} s] ${line}` : line)));
  // For the task's Progress log: vitest keeps a passing test's console to itself.
  if (REPORT) await writeFile(REPORT, `${report.join("\n")}\n`);
}

/** The Office with the Office instructions saved and the Developer on Haiku, with Chat on. */
async function officeWithTheInstructions(): Promise<Api> {
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
  const { api } = checkApi(url);
  await api("PUT", "/settings/office-instructions", { officeInstructions: OFFICE_INSTRUCTIONS });
  await hireOnHaiku(api, [
    ["planner", "Jan"],
    ["developer", "Ada"],
  ]);
  const { card } = roleSchema.parse(await api("GET", "/roles/developer"));
  await api("PUT", "/roles/developer/card", {
    ...card,
    capabilities: { ...card.capabilities, chat: true },
  });
  await note(`Office instructions saved; the Developer on ${JSON.stringify(card.roleOverride)}`);
  return api;
}

/** Signs the Office default's engine in with the given token; fails, before any model call, if it isn't. */
async function signedInEngine(api: Api): Promise<void> {
  const { officeDefault } = engineSettingsSchema.parse(await api("GET", "/settings/engines"));
  const engineId = officeDefault?.engineId;
  if (engineId === undefined) throw new Error("Settings › Engines lists no engine.");
  if (ENGINE_TOKEN !== undefined) {
    await api("PUT", `/settings/engines/${engineId}/token`, { token: ENGINE_TOKEN });
  }
  const account = engineAccountSchema.parse(
    await api("GET", `/settings/engines/${engineId}/account`),
  );
  await note(`Engine ${engineId}: signed in ${account.signedIn}, plan ${account.plan}`);
  if (!account.signedIn) {
    throw new Error(
      `The engine ${engineId} is signed out in this check's new Office data folder: set OFFICE_CHECK_ENGINE_TOKEN to a token from \`claude setup-token\`.`,
    );
  }
}

describe.runIf(MODE === "live" && TEST_PROJECT)("Task 50's check on the Test Project", () => {
  let api: Api;
  let projectId: string;
  let taskId: string | undefined;
  const base = `office-check-50-${randomBytes(4).toString("hex")}`;

  beforeAll(async () => {
    scratch = await mkdtemp(join(tmpdir(), "office-instructions-check-"));
    officeData = join(scratch, "office-data");
    await git(TEST_PROJECT, "branch", "--no-track", base, "main");
    api = await officeWithTheInstructions();
    const project = await addTestProject(api, TEST_PROJECT, {
      baseBranch: base,
      publishingMode: "merge",
    });
    projectId = project.id;
  });

  afterAll(async () => {
    await app?.close();
    await cleanUpTestProject(TEST_PROJECT, { base, taskId, officeData });
    await note("Cleaned up the Task's worktree and branch, and the base branch");
    await rm(scratch, { recursive: true, force: true });
  });

  it(
    "obeys a line of the Office instructions in a chat",
    async () => {
      const thread = threadSchema.parse(await api("POST", "/chats/developer/threads"));
      await signedInEngine(api);

      await api("POST", `/threads/${thread.id}/messages`, { text: QUESTION });
      await untilThreadWaits(api, thread.id, REPLY_MS);
      const messages = messageListSchema.parse(await api("GET", `/threads/${thread.id}/messages`));
      await note("The chat", ...messages.map((message) => `  ${messageLine(message)}`));

      const replies = messages.filter((message) => message.kind === "person");
      expect(replies).toHaveLength(1);
      expect(replies[0]?.kind === "person" && replies[0].text).toContain(MARK);
    },
    REPLY_MS + 120_000,
  );

  it(
    "obeys a line of the Office instructions in an Agent Stage, leaving main as it was",
    async () => {
      const mainBefore = await git(TEST_PROJECT, "rev-parse", "main");
      taskId = await plannedByTheUser(api, projectId);
      const library = pipelineSchema.parse(await api("GET", "/pipelines/quick-fix"));
      await api("PUT", `/tasks/${taskId}/stages`, { stages: withGateForTests(library) });
      await signedInEngine(api);

      await api("POST", `/tasks/${taskId}/start`);
      const task = await untilWalkStops(api, taskId, WALK_MS);
      const stages = await stagesOf(api, taskId);
      for (const stage of stages) await note(...(await stageLines(api, stage)));
      await note(`Task ${task.state}`);

      const implement = stages.find(({ stage }) => stage.key === "implement");
      const outcome = implement?.runs.at(-1)?.outcome;
      expect(implement?.state).toBe("done");
      expect(outcome?.status === "done" && outcome.summary).toContain(MARK);
      expect(stages.find(({ stage }) => stage.key === GATE.key)?.state).toBe("waiting-on-you");

      await api("POST", `/tasks/${taskId}/gate/drop`);
      expect((await untilWalkStops(api, taskId, WALK_MS)).state).toBe("dropped");
      expect(await git(TEST_PROJECT, "rev-parse", "main")).toBe(mainBefore);
    },
    WALK_MS * 2,
  );
});

/** A Task the user plans and marks Ready on Quick fix; the Planner's session never starts. */
async function plannedByTheUser(api: Api, projectId: string): Promise<string> {
  const idea = ideaSchema.parse(
    await api("POST", "/ideas", {
      title: "Run one Stage that changes nothing",
      notes: "A check of what a session is told.",
      projectId,
    }),
  );
  const taskId = taskSchema.parse(await api("POST", `/ideas/${idea.id}/shape`, { projectId })).id;
  await api("POST", `/tasks/${taskId}/planning`);
  await api("PUT", `/tasks/${taskId}/plan`, { plan: PLAN, filesToChange: [] });
  await api("PUT", `/tasks/${taskId}/definition-of-done`, {
    definitionOfDone: DEFINITION_OF_DONE,
  });
  await api("POST", `/tasks/${taskId}/plan/confirm`);
  await api("POST", `/tasks/${taskId}/definition-of-done/confirm`);
  await api("PUT", `/tasks/${taskId}/pipeline`, { pipelineId: "quick-fix" });
  expect(taskSchema.parse(await api("POST", `/tasks/${taskId}/ready`)).state).toBe("ready");
  return taskId;
}

function withGateForTests({ stages }: { readonly stages: readonly Stage[] }): Stage[] {
  return stages.map((stage) => (stage.key === "tests" ? GATE : stage));
}
