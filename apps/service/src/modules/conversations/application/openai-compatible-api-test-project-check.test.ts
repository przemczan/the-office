import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { INestApplication } from "@nestjs/common";
import {
  engineSettingsSchema,
  ideaSchema,
  messageListSchema,
  pipelineSchema,
  roleSchema,
  taskSchema,
  threadSchema,
  type Stage,
} from "@the-office/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addTestProject,
  checkApi,
  cleanUpTestProject,
  git,
  messageLine,
  stageLines,
  stagesOf,
  tokensOf,
  untilThreadWaits,
  untilWalkStops,
  type Api,
} from "../../../../test/live-check.js";
import { startTestApplication } from "../../../../test/test-application.js";
import { testDatabaseUrl } from "../../../../test/test-database.js";
import { AppModule } from "../../../app.module.js";
import { GITHUB_SITE } from "../../../platform/config/github-site.js";

/**
 * Task 35's check on the Test Project: an API endpoint set in Settings › Engines, made the Office
 * default, and the Developer's Role card on one of its models. In the Developer's chat, a question only reading the
 * Test Project answers, replied to in one message; then a Task the user plans (the Planner never
 * runs) runs Implement on that model, as Quick fix edited with a Gate before Publish, and is
 * dropped at the Gate. Its base is a local branch that tracks no remote, so nothing leaves the
 * workstation. Live and slow, so it runs only with OFFICE_ENGINE_TESTS=live,
 * OFFICE_TEST_PROJECT=<the Test Project's folder>, OFFICE_API_BASE_URL and OFFICE_API_MODEL (with
 * OFFICE_API_CONTEXT_WINDOW when not 100000), and OFFICE_CHECK_REPORT=<a file> to keep what it saw;
 * `-t` picks one test. It hires the Developer from its preset, so it runs alone.
 */
const MODE = process.env["OFFICE_ENGINE_TESTS"];
const TEST_PROJECT = process.env["OFFICE_TEST_PROJECT"] ?? "";
const BASE_URL = process.env["OFFICE_API_BASE_URL"];
const MODEL = process.env["OFFICE_API_MODEL"];
const CONTEXT_WINDOW = Number(process.env["OFFICE_API_CONTEXT_WINDOW"] ?? 100_000);
const REPORT = process.env["OFFICE_CHECK_REPORT"];
const WEB_APP = fileURLToPath(new URL("../../../../../web", import.meta.url));
/** A local server may take minutes over each request. */
const REPLY_MS = 30 * 60_000;
const WALK_MS = 60 * 60_000;

const QUESTION =
  "How many workspaces does the root package.json of the notnullsoft-admin Project list? " +
  "Read the file to find out, then reply with the number only.";
const WORKSPACES = "3";

const README_LINE = "Edited on a local model by The Office's check of task 35.";
/** In a protected folder (spec §6), so the Office rules refuse the Write whatever the profile. */
const REFUSED_FILE = ".claude/office-check.txt";
const PLAN = [
  "1. Read README.md at the repository's root.",
  `2. Add one line at its very end, with the Edit tool: ${README_LINE}`,
  "3. Run the command `git status --short` and look at what it says.",
  `4. Create the file ${REFUSED_FILE} containing the word check, with the Write tool. The Office ` +
    "refuses it: do not try again or another way.",
  "Change nothing else.",
].join("\n");

/** In place of Publish, so the Task stops before anything leaves the workstation. */
const GATE: Stage = { kind: "gate", key: "look", name: "Look", optional: false };

const report: string[] = [];
let begun = Date.now();
let scratch: string;
let officeData: string;
let app: INestApplication | undefined;

async function note(...lines: string[]): Promise<void> {
  const seconds = Math.round((Date.now() - begun) / 1000);
  report.push(...lines.map((line, i) => (i === 0 ? `[${seconds} s] ${line}` : line)));
  // For the task's Progress log: vitest keeps a passing test's console to itself.
  if (REPORT) await writeFile(REPORT, `${report.join("\n")}\n`);
}

/** The Office with the API endpoint set and the Developer on its model, with Chat on. */
async function officeOnTheEndpoint(): Promise<Api> {
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
  const saved = engineSettingsSchema.parse(await api("GET", "/settings/engines"));
  const claudeCode = saved.engines.filter(({ kind }) => kind === "claude-code");
  const edit = {
    name: "Strata",
    kind: "openai-compatible-api",
    defaultModel: MODEL,
    baseUrl: BASE_URL,
    key: "",
    models: [{ id: MODEL, contextWindow: CONTEXT_WINDOW }],
  } as const;
  const settings = engineSettingsSchema.parse(
    await api("PUT", "/settings/engines", {
      engines: [...claudeCode, edit],
      officeDefault: saved.officeDefault,
      searchEndpoint: null,
      modelPrices: [],
    }),
  );
  const strata = settings.engines.find(({ kind }) => kind === "openai-compatible-api");
  if (!strata) throw new Error("Settings › Engines lists no API endpoint after the Save.");
  // A second Save, as only a saved engine has the id the Office default names it by.
  await api("PUT", "/settings/engines", {
    engines: [...claudeCode, { ...edit, id: strata.id }],
    officeDefault: { engineType: "openai-compatible-api", engineId: strata.id },
    searchEndpoint: null,
    modelPrices: [],
  });
  const hired = roleSchema.parse(
    await api("POST", "/roles", { roleKey: "developer", name: "Ada" }),
  );
  await api("PUT", "/roles/developer/card", {
    ...hired.card,
    engineSettings: { "openai-compatible-api": { model: MODEL, effort: null } },
    skills: [],
    capabilities: { ...hired.card.capabilities, chat: true },
  });
  await note(`The Developer on ${strata.id}/${MODEL}`);
  return api;
}

describe.runIf(MODE === "live" && TEST_PROJECT && BASE_URL && MODEL)(
  "Task 35's check on the Test Project",
  () => {
    beforeEach(async () => {
      begun = Date.now();
      scratch = await mkdtemp(join(tmpdir(), "office-api-engine-check-"));
      officeData = join(scratch, "office-data");
    });

    afterEach(async () => {
      await app?.close();
      app = undefined;
      await rm(scratch, { recursive: true, force: true });
    });

    it(
      "answers in a chat on an API endpoint's model, after reading the Project, in one message",
      async () => {
        try {
          const api = await officeOnTheEndpoint();
          await addTestProject(api, TEST_PROJECT);
          const thread = threadSchema.parse(await api("POST", "/chats/developer/threads"));
          await api("POST", `/threads/${thread.id}/messages`, { text: QUESTION });
          await untilThreadWaits(api, thread.id, REPLY_MS);
          const messages = messageListSchema.parse(
            await api("GET", `/threads/${thread.id}/messages`),
          );
          const { tokens } = threadSchema.parse(await api("GET", `/threads/${thread.id}`));
          await note(
            `Thread answered; tokens ${tokensOf(tokens)} ${JSON.stringify(tokens)}`,
            ...messages.map((message) => `  ${messageLine(message)}`),
          );

          const replies = messages.filter((message) => message.kind === "person");
          expect(
            messages.some((message) => message.kind === "tool-activity" && message.tool === "Read"),
          ).toBe(true);
          expect(replies).toHaveLength(1);
          expect(replies[0]?.kind === "person" && replies[0].text).toContain(WORKSPACES);
        } finally {
          await app?.close();
          await cleanUpTestProject(TEST_PROJECT, { taskIds: [], officeData });
        }
      },
      REPLY_MS + 120_000,
    );

    it(
      "runs Implement on an API endpoint's model: a read, an edit, a command, a refusal, an Office tool",
      async () => {
        const base = `office-check-35-${randomBytes(4).toString("hex")}`;
        const mainBefore = await git(TEST_PROJECT, "rev-parse", "main");
        let taskId: string | undefined;
        try {
          await git(TEST_PROJECT, "fetch", "origin", "main");
          await git(TEST_PROJECT, "branch", "--no-track", base, "origin/main");
          const api = await officeOnTheEndpoint();
          const project = await addTestProject(api, TEST_PROJECT, {
            baseBranch: base,
            publishingMode: "merge",
          });
          taskId = await plannedByTheUser(api, project.id);
          const library = pipelineSchema.parse(await api("GET", "/pipelines/quick-fix"));
          await api("PUT", `/tasks/${taskId}/stages`, { stages: withGateBeforePublish(library) });
          await note(`Task ${taskId} Ready on ${base}, Quick fix with a Gate before Publish`);

          await api("POST", `/tasks/${taskId}/start`);
          const task = await untilWalkStops(api, taskId, WALK_MS);
          const stages = await stagesOf(api, taskId);
          for (const stage of stages) await note(...(await stageLines(api, stage)));
          await note(`Task ${task.state}`);
          const implement = stages.find(({ stage }) => stage.key === "implement");
          const threadId = implement?.runs.at(-1)?.threadId ?? null;
          const messages =
            threadId === null
              ? []
              : messageListSchema.parse(await api("GET", `/threads/${threadId}/messages`));
          const tools = messages.flatMap((message) =>
            message.kind === "tool-activity" ? [message.tool] : [],
          );
          expect(implement?.state).toBe("done");
          expect(tools).toEqual(expect.arrayContaining(["Read", "Edit"]));
          expect(tools.some((tool) => tool === "Bash" || tool === "PowerShell")).toBe(true);
          expect(
            messages.some((message) => message.kind === "refusal" && message.tool === "Write"),
          ).toBe(true);
          expect(stages.find(({ stage }) => stage.key === GATE.key)?.state).toBe("waiting-on-you");

          await api("POST", `/tasks/${taskId}/gate/drop`);
          expect((await untilWalkStops(api, taskId, WALK_MS)).state).toBe("dropped");
          expect(await git(TEST_PROJECT, "rev-parse", "main")).toBe(mainBefore);
        } finally {
          await app?.close();
          await cleanUpTestProject(TEST_PROJECT, { base, taskIds: [taskId], officeData });
          await note("Cleaned up the Task's worktree and branch, and the base branch");
        }
      },
      WALK_MS * 2,
    );
  },
);

/** A Task the user plans and marks Ready on Quick fix, the Planner never asked. */
async function plannedByTheUser(api: Api, projectId: string): Promise<string> {
  const idea = ideaSchema.parse(
    await api("POST", "/ideas", {
      title: "Say on the README that a local model edited it",
      notes: "A one-line change to check the OpenAI-compatible API engine.",
      projectId,
    }),
  );
  const taskId = taskSchema.parse(await api("POST", `/ideas/${idea.id}/shape`, { projectId })).id;
  // Planning needs a Planner and opens their Thread, whose session starts only once the user writes
  // in it, so the Planner never runs.
  await api("POST", "/roles", { roleKey: "planner", name: "Jan" });
  await api("POST", `/tasks/${taskId}/planning`);
  await api("PUT", `/tasks/${taskId}/plan`, { plan: PLAN, filesToChange: ["README.md"] });
  await api("PUT", `/tasks/${taskId}/definition-of-done`, {
    definitionOfDone: [
      `README.md ends with the line "${README_LINE}"`,
      "No other file is changed.",
    ],
  });
  await api("POST", `/tasks/${taskId}/plan/confirm`);
  await api("POST", `/tasks/${taskId}/definition-of-done/confirm`);
  await api("PUT", `/tasks/${taskId}/pipeline`, { pipelineId: "quick-fix" });
  expect(taskSchema.parse(await api("POST", `/tasks/${taskId}/ready`)).state).toBe("ready");
  return taskId;
}

function withGateBeforePublish({ stages }: { readonly stages: readonly Stage[] }): Stage[] {
  const publishAt = stages.findIndex(({ key }) => key === "publish");
  if (publishAt < 0) throw new Error("Quick fix has no Publish.");
  return stages.toSpliced(publishAt, 0, GATE);
}
