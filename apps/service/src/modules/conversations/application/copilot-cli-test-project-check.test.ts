import { randomBytes } from "node:crypto";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { INestApplication } from "@nestjs/common";
import {
  COPILOT_CLI_AUTO_MODEL,
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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
import { freshTestDatabase, type FreshTestDatabase } from "../../../../test/test-database.js";
import { AppModule } from "../../../app.module.js";
import { GITHUB_SITE } from "../../../platform/git-identity/github-site.js";

/**
 * The Copilot CLI engine's check on the Test Project: a Copilot CLI engine added in Settings ›
 * Engines, signed in by a pasted token, and the Developer's Role card on it. In the Developer's
 * chat, a question only reading the Test Project answers, replied to in one message; then a Task
 * the user plans (the Planner never runs) runs Implement on that engine, as Quick fix edited with a
 * Gate before Publish, and is dropped at the Gate. Its base is a local branch that tracks no
 * remote, so nothing leaves the workstation. Each test removes the engine at its end. Live and
 * slow, so it runs only with OFFICE_ENGINE_TESTS=live, OFFICE_TEST_PROJECT=<the Test Project's
 * folder> and OFFICE_COPILOT_TOKEN (a fine-grained token with "Copilot Requests", as Paste a token
 * instead takes), with OFFICE_COPILOT_MODEL when not Auto, and OFFICE_CHECK_REPORT=<a file> to keep
 * what it saw; `-t` picks one test. It hires the Developer from its preset, so it runs alone.
 */
const MODE = process.env["OFFICE_ENGINE_TESTS"];
const TEST_PROJECT = process.env["OFFICE_TEST_PROJECT"] ?? "";
const TOKEN = process.env["OFFICE_COPILOT_TOKEN"];
/** Auto by default: an account signed in by a token may list no model and refuse any named. */
const MODEL = process.env["OFFICE_COPILOT_MODEL"] ?? COPILOT_CLI_AUTO_MODEL;
const REPORT = process.env["OFFICE_CHECK_REPORT"];
const WEB_APP = fileURLToPath(new URL("../../../../../web", import.meta.url));
const REPLY_MS = 10 * 60_000;
const WALK_MS = 30 * 60_000;
/** The engine's folder goes once its sessions have ended. */
const FOLDER_REMOVED_MS = 60_000;

const QUESTION =
  "How many workspaces does the root package.json of the notnullsoft-admin Project list? " +
  "Read the file to find out, then reply with the number only.";
const WORKSPACES = "3";

const README_LINE = "Edited on Copilot by The Office's check of the Copilot CLI engine.";
/** In a protected folder (spec §6), so the Office rules refuse the Write whatever the profile. */
const REFUSED_FILE = ".claude/office-check.txt";
const PLAN = [
  "1. Read README.md at the repository's root.",
  `2. Add one line at its very end: ${README_LINE}`,
  "3. Run the command `git status --short` in the shell and look at what it says.",
  `4. Create the file ${REFUSED_FILE} containing the word check. The Office refuses it: do not ` +
    "try again or another way.",
  "Change nothing else.",
].join("\n");

/** Just before Publish, so the Task stops before anything leaves the workstation. */
const GATE: Stage = { kind: "gate", key: "look", name: "Look", optional: false };

const report: string[] = [];
let begun = Date.now();
let scratch: string;
let officeData: string;
/** Each test's own, so an engine or a hire a failed test left doesn't meet the next. */
let database: FreshTestDatabase;
let app: INestApplication | undefined;

async function note(...lines: string[]): Promise<void> {
  const seconds = Math.round((Date.now() - begun) / 1000);
  report.push(...lines.map((line, i) => (i === 0 ? `[${seconds} s] ${line}` : line)));
  // For the task's Progress log: vitest keeps a passing test's console to itself.
  if (REPORT) await writeFile(REPORT, `${report.join("\n")}\n`);
}

interface OfficeOnCopilot {
  readonly api: Api;
  readonly engineId: string;
}

/** The Office on the test's database and Office data, with its API. */
async function startOffice(): Promise<Api> {
  let url: string;
  ({ app, url } = await startTestApplication({
    imports: [
      AppModule.register(
        {
          host: "127.0.0.1",
          port: 0,
          databaseUrl: database.url,
          officeDataDirectory: officeData,
          gitHub: GITHUB_SITE,
        },
        { directory: WEB_APP, source: "built" },
      ),
    ],
  }));
  return checkApi(url).api;
}

/**
 * The Office with a Copilot CLI engine added and signed in by the pasted token, as the web does,
 * and the Developer on it, with Chat on.
 */
async function officeOnCopilot(): Promise<OfficeOnCopilot> {
  const api = await startOffice();
  const saved = engineSettingsSchema.parse(await api("GET", "/settings/engines"));
  const settings = engineSettingsSchema.parse(
    await api("PUT", "/settings/engines", {
      engines: [
        ...saved.engines.filter(({ kind }) => kind === "claude-code"),
        { name: "Copilot", kind: "copilot-cli", defaultModel: MODEL },
      ],
      officeDefault: saved.officeDefault,
      searchEndpoint: null,
      modelPrices: [],
    }),
  );
  const copilot = settings.engines.find(({ kind }) => kind === "copilot-cli");
  if (!copilot) throw new Error("Settings › Engines lists no Copilot CLI engine after the Save.");
  await api("PUT", `/settings/engines/${copilot.id}/token`, { token: TOKEN });
  const account = engineAccountSchema.parse(
    await api("GET", `/settings/engines/${copilot.id}/account`),
  );
  expect(account).toMatchObject({ signedIn: true, pastedToken: true });

  const hired = roleSchema.parse(
    await api("POST", "/roles", { roleKey: "developer", name: "Ada" }),
  );
  await api("PUT", "/roles/developer/card", {
    ...hired.card,
    roleOverride: { engineId: copilot.id, model: MODEL },
    skills: [],
    capabilities: { ...hired.card.capabilities, chat: true },
  });
  await note(`The Developer on ${copilot.id}/${MODEL}, signed in by a pasted token`);
  return { api, engineId: copilot.id };
}

/**
 * Removes the Copilot CLI engine, the Developer's override moving to the Claude Code engine. Its
 * folder goes once its sessions have ended, and an open chat's session lives on, so The Office
 * restarts, ending them, and its start removes the folder of every engine no longer listed.
 */
async function removeTheEngine({ api, engineId }: OfficeOnCopilot): Promise<void> {
  const { engines } = engineSettingsSchema.parse(await api("GET", "/settings/engines"));
  const replacement = engines.find(({ kind }) => kind === "claude-code");
  if (!replacement) throw new Error("Settings › Engines lists no Claude Code engine to take over.");
  const left = engineSettingsSchema.parse(
    await api("DELETE", `/settings/engines/${engineId}?replacement=${replacement.id}`),
  );
  expect(left.engines.map(({ id }) => id)).not.toContain(engineId);
  await app?.close();
  const restarted = await startOffice();
  const { engines: listed } = engineSettingsSchema.parse(
    await restarted("GET", "/settings/engines"),
  );
  expect(listed.map(({ id }) => id)).not.toContain(engineId);
  const folder = join(officeData, "engines", engineId);
  await vi.waitFor(
    async () => {
      if (await exists(folder)) throw new Error(`${folder} is still there.`);
    },
    { timeout: FOLDER_REMOVED_MS, interval: 1_000 },
  );
  await note(`Removed ${engineId}, and its folder with it`);
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

describe.runIf(MODE === "live" && TEST_PROJECT && TOKEN)(
  "The Copilot CLI engine's check on the Test Project",
  () => {
    beforeEach(async () => {
      begun = Date.now();
      scratch = await mkdtemp(join(tmpdir(), "office-copilot-engine-check-"));
      officeData = join(scratch, "office-data");
      database = await freshTestDatabase();
    });

    afterEach(async () => {
      await app?.close();
      app = undefined;
      await database.drop();
      await rm(scratch, { recursive: true, force: true });
    });

    it(
      "answers in a chat on a Copilot CLI engine, after reading the Project, in one message",
      async () => {
        try {
          const office = await officeOnCopilot();
          const { api } = office;
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

          await removeTheEngine(office);
        } finally {
          await app?.close();
          await cleanUpTestProject(TEST_PROJECT, { taskIds: [], officeData });
        }
      },
      REPLY_MS + 2 * FOLDER_REMOVED_MS,
    );

    it(
      "runs Implement on a Copilot CLI engine: an edit, a command, a refusal, the Stage's result",
      async () => {
        const base = `office-check-copilot-${randomBytes(4).toString("hex")}`;
        const mainBefore = await git(TEST_PROJECT, "rev-parse", "main");
        let taskId: string | undefined;
        try {
          await git(TEST_PROJECT, "fetch", "origin", "main");
          await git(TEST_PROJECT, "branch", "--no-track", base, "origin/main");
          const office = await officeOnCopilot();
          const { api } = office;
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
          const lastRun = implement?.runs.at(-1);
          const threadId = lastRun?.threadId ?? null;
          const messages =
            threadId === null
              ? []
              : messageListSchema.parse(await api("GET", `/threads/${threadId}/messages`));
          const tools = messages.flatMap((message) =>
            message.kind === "tool-activity" ? [message.tool] : [],
          );
          expect(implement?.state).toBe("done");
          expect(tools.some((tool) => tool === "Edit" || tool === "Write")).toBe(true);
          expect(tools.some((tool) => tool === "Bash" || tool === "PowerShell")).toBe(true);
          expect(
            messages.some(
              (message) => message.kind === "refusal" && message.reason.includes(".claude"),
            ),
          ).toBe(true);
          expect(lastRun?.outcome).toMatchObject({ status: "done", summary: expect.any(String) });
          expect(stages.find(({ stage }) => stage.key === GATE.key)?.state).toBe("waiting-on-you");

          await api("POST", `/tasks/${taskId}/gate/drop`);
          expect((await untilWalkStops(api, taskId, WALK_MS)).state).toBe("dropped");
          expect(await git(TEST_PROJECT, "rev-parse", "main")).toBe(mainBefore);

          await removeTheEngine(office);
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
      title: "Say on the README that Copilot edited it",
      notes: "A one-line change to check the Copilot CLI engine.",
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

/**
 * Quick fix's Stages with the Gate taking Publish's place on the canvas: every route to Publish
 * leads to the Gate instead, the Gate's one route to Publish, and Publish and what follows it move
 * one column on.
 */
function withGateBeforePublish({ stages }: { readonly stages: readonly Stage[] }): Stage[] {
  const publish = stages.find(({ key }) => key === "publish");
  if (!publish?.place) throw new Error("Quick fix has no Publish on the canvas.");
  const publishColumn = publish.place.column;
  const gate: Stage = {
    ...GATE,
    routes: [{ to: publish.key, condition: null }],
    place: publish.place,
  };
  const rerouted = stages.map((stage): Stage => ({
    ...stage,
    routes: stage.routes?.map((route) =>
      route.to === publish.key ? { ...route, to: GATE.key, toName: GATE.name } : route,
    ),
    place:
      stage.place && stage.place.column >= publishColumn
        ? { ...stage.place, column: stage.place.column + 1 }
        : stage.place,
  }));
  return rerouted.toSpliced(stages.indexOf(publish), 0, gate);
}
