import { randomBytes } from "node:crypto";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { INestApplication } from "@nestjs/common";
import {
  ideaSchema,
  mcpServerReviewSchema,
  messageListSchema,
  pipelineSchema,
  roleSchema,
  taskSchema,
  threadListSchema,
  type Message,
  type Stage,
  type StageState,
} from "@the-office/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FAKE_STDIO_MCP_SERVER } from "../../../platform/mcp/fake-mcp-servers.fixtures.js";
import { commandLinesHolding, processMark } from "../../../platform/os/process-trees.fixtures.js";
import {
  addTestProject,
  checkApi,
  cleanUpTestProject,
  hireOnHaiku,
  messageLine,
  stageLines,
  stagesOf,
  untilWalkStops,
  type Api,
} from "../../../../test/live-check.js";
import { startTestApplication } from "../../../../test/test-application.js";
import { testDatabaseUrl } from "../../../../test/test-database.js";
import { AppModule } from "../../../app.module.js";
import { GITHUB_SITE } from "../../../platform/git-identity/github-site.js";

/**
 * Task 36's check on the Test Project (docs/tasks/36-mcp-servers.md, step 8): the fake local MCP
 * server, run by Node, added to the library, reviewed, turned on and given to the Developer on Haiku,
 * with a secret Server value set Office-wide and overridden on the Project's page. Implement, the
 * only Agent Stage, calls one tool the card sets to Allowed and one left at Consult Devops, which
 * waits on Devops in a Consultation; the user takes it over with "Allow once", and the repeated call
 * runs. The Task stops at a Gate in place of Tests and Publish and is dropped there, so nothing
 * leaves the workstation. Meanwhile it watches the sessions' folders for the private MCP config
 * file and every process's command line for the secret. Live, so it runs only with
 * OFFICE_ENGINE_TESTS=live and OFFICE_TEST_PROJECT=<the Test Project's folder>, with
 * OFFICE_CHECK_REPORT=<a file> to keep what it saw. It hires from the presets, so it runs alone.
 */
const MODE = process.env["OFFICE_ENGINE_TESTS"];
const TEST_PROJECT = process.env["OFFICE_TEST_PROJECT"] ?? "";
const REPORT = process.env["OFFICE_CHECK_REPORT"];
const WEB_APP = fileURLToPath(new URL("../../../../../web", import.meta.url));
const STAGE_MS = 20 * 60_000;
const WATCH_MS = 2_000;

const SERVER = "office-check";
const ALLOWED_TOOL = "environment-variable";
const CONSULTED_TOOL = "echo";
const SERVER_VALUE = "FAKE_TOKEN";
const PROJECT_WORD = "heron";
const ECHOED = "approved in a Consultation";

const PLAN = [
  `1. Call the MCP tool mcp__${SERVER}__${ALLOWED_TOOL} with the name ${SERVER_VALUE}. Its answer ` +
    "is a secret: never write it anywhere, in a file, a command, a tool's input or your summary. " +
    "Keep only the word before its first dash.",
  `2. Call the MCP tool mcp__${SERVER}__${CONSULTED_TOOL} with the text "${ECHOED}". When The ` +
    'Office holds the call for approval, end your turn as it says; after the answer "Allow once", ' +
    "make the same call again.",
  "3. Change no file and run no command. Finish with a summary of one line: the word from step 1, " +
    "then what the echo answered.",
].join("\n");

/** In place of Tests and Publish, so the Task stops before anything leaves the workstation. */
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

describe.runIf(MODE === "live" && TEST_PROJECT)("Task 36's check on the Test Project", () => {
  beforeEach(async () => {
    begun = Date.now();
    scratch = await mkdtemp(join(tmpdir(), "office-mcp-check-"));
    officeData = join(scratch, "office-data");
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
    await rm(scratch, { recursive: true, force: true });
  });

  it(
    "runs an Allowed MCP tool at once, and one at Consult Devops after a Consultation",
    async () => {
      const officeWideValue = `osprey-${randomBytes(16).toString("hex")}`;
      const projectValue = `${PROJECT_WORD}-${randomBytes(16).toString("hex")}`;
      // On the server's command line and its child's, so the check finds both after the sessions.
      const mark = processMark();
      let taskId: string | undefined;
      const watch = new SessionWatch(officeData, [officeWideValue, projectValue]);
      try {
        const { api, call } = await theOffice();
        await hireOnHaiku(api, [
          ["developer", "Ada"],
          ["devops", "Ola"],
        ]);
        const project = await addTestProject(api, TEST_PROJECT);
        await addTheServer(api, officeWideValue, mark);
        await api("PUT", `/projects/${project.id}/server-values/${SERVER}`, {
          serverValues: [{ name: SERVER_VALUE, projectValue }],
        });
        taskId = await plannedByTheUser(api, project.id);
        const library = pipelineSchema.parse(await api("GET", "/pipelines/quick-fix"));
        const implementOnly = library.stages.filter(({ key }) => key === "implement");
        await api("PUT", `/tasks/${taskId}/stages`, { stages: [...implementOnly, GATE] });

        watch.start();
        await api("POST", `/tasks/${taskId}/start`);
        const consultation = await untilConsultationOpens(api, taskId);
        await note(`Consultation "${consultation.title}" opened with ${consultation.roleKey}`);
        const decisionId = consultation.consultation?.decisionId ?? "";
        const answered = await call("POST", `/decisions/${decisionId}/answer`, {
          kind: "option",
          option: 0,
        });
        // Devops may have answered first, which the run's report shows.
        await note(`The user took the Consultation over with Allow once: ${answered.status}`);

        await untilImplementEnds(api, taskId);
        const task = await untilWalkStops(api, taskId, STAGE_MS);
        watch.stop();
        const stages = await stagesOf(api, taskId);
        for (const stage of stages) await note(...(await stageLines(api, stage)));
        const threads = threadListSchema.parse(await api("GET", `/tasks/${taskId}/threads`));
        for (const thread of threads.filter(({ consultation: c }) => c !== null)) {
          const lines = (await messagesOf(api, thread.id)).map((m) => `    | ${messageLine(m)}`);
          await note(`## Consultation ${thread.title}: ${thread.state}`, ...lines);
        }
        const seen = await watch.report();
        await note(`Task ${task.state}`, ...seen.lines);

        const implement = stages.find(({ stage }) => stage.key === "implement");
        // Implement runs again in its own Thread for the answer; a run may also start a new one.
        const implementThreads = new Set(implement?.runs.flatMap(({ threadId: id }) => id ?? []));
        const messages = (
          await Promise.all([...implementThreads].map((id) => messagesOf(api, id)))
        ).flat();
        const tools = messages.flatMap((m) => (m.kind === "tool-activity" ? [m.tool] : []));
        const allowed = `mcp__${SERVER}__${ALLOWED_TOOL}`;
        const consulted = `mcp__${SERVER}__${CONSULTED_TOOL}`;
        expect(implement?.state).toBe("done");
        expect(tools).toContain(allowed);
        expect(tools.filter((tool) => tool === consulted).length).toBeGreaterThanOrEqual(2);
        expect(messages.some((m) => m.kind === "refusal" && m.tool === allowed)).toBe(false);
        expect(JSON.stringify(implement?.runs.at(-1)?.outcome)).toContain(PROJECT_WORD);
        expect(task.state).toBe("waiting-on-you");

        const officeLines = JSON.stringify(
          [...messages, ...(await consultationMessages(api, threads))].filter(
            (m) => m.kind !== "person",
          ),
        );
        for (const value of [officeWideValue, projectValue]) {
          expect(officeLines).not.toContain(value.slice(value.indexOf("-") + 1));
        }
        expect(seen.configFiles.length).toBeGreaterThan(0);
        expect(seen.configFilesLeft).toEqual([]);
        expect(seen.commandLinesWithValue).toBe(0);
        const serverProcessesLeft = await commandLinesHolding([mark]);
        await note(`Processes of the MCP server left after the sessions: ${serverProcessesLeft}`);
        expect(serverProcessesLeft).toBe(0);

        await api("POST", `/tasks/${taskId}/gate/drop`);
        expect((await untilWalkStops(api, taskId, STAGE_MS)).state).toBe("dropped");
      } finally {
        watch.stop();
        await app?.close();
        await cleanUpTestProject(TEST_PROJECT, { taskIds: [taskId], officeData });
        await note("Cleaned up the Task's worktree and branch");
      }
    },
    STAGE_MS * 2,
  );
});

async function theOffice(): Promise<ReturnType<typeof checkApi>> {
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
  return checkApi(url);
}

/**
 * The fake server added as step 7b describes, reviewed and turned on, given to the Developer, its
 * one tool Allowed on their card; every other tool stays at Consult Devops.
 */
async function addTheServer(api: Api, officeWideValue: string, mark: string): Promise<void> {
  await api("POST", "/mcp-servers", {
    name: SERVER,
    transport: "stdio",
    command: process.execPath,
    arguments: [FAKE_STDIO_MCP_SERVER, mark],
    serverValues: [{ name: SERVER_VALUE, secret: true, required: true, officeWideValue }],
  });
  const review = mcpServerReviewSchema.parse(await api("GET", `/mcp-servers/${SERVER}/review`));
  if (!review.connected) throw new Error(`The review couldn't connect: ${review.problem}`);
  await api("PUT", `/mcp-servers/${SERVER}/state`, {
    state: "on",
    reviewDigest: review.reviewDigest,
  });
  await api("PUT", `/mcp-servers/${SERVER}/roles`, { roles: ["developer"] });
  const { card } = roleSchema.parse(await api("GET", "/roles/developer"));
  await api("PUT", "/roles/developer/card", {
    ...card,
    permissionProfile: {
      ...card.permissionProfile,
      mcpTools: { [`${SERVER}/${ALLOWED_TOOL}`]: { kind: "allowed" } },
    },
  });
  await note(
    `${SERVER} on with ${review.tools.map(({ name }) => name).join(", ")}; ` +
      `${SERVER}/${ALLOWED_TOOL} Allowed for the Developer`,
  );
}

/** A Task the user plans and marks Ready on Quick fix, the Planner never asked. */
async function plannedByTheUser(api: Api, projectId: string): Promise<string> {
  const idea = ideaSchema.parse(
    await api("POST", "/ideas", {
      title: "Call the check's MCP tools",
      notes: "Two calls of a fake MCP server's tools, to check The Office's MCP servers.",
      projectId,
    }),
  );
  const taskId = taskSchema.parse(await api("POST", `/ideas/${idea.id}/shape`, { projectId })).id;
  // Planning needs a Planner and opens their Thread, whose session starts only once the user writes
  // in it, so the Planner never runs.
  await api("POST", "/roles", { roleKey: "planner", name: "Jan" });
  await api("POST", `/tasks/${taskId}/planning`);
  await api("PUT", `/tasks/${taskId}/plan`, { plan: PLAN, filesToChange: [] });
  await api("PUT", `/tasks/${taskId}/definition-of-done`, {
    definitionOfDone: [
      `mcp__${SERVER}__${ALLOWED_TOOL} was called once and mcp__${SERVER}__${CONSULTED_TOOL} ran.`,
      "No file is changed.",
    ],
  });
  await api("POST", `/tasks/${taskId}/plan/confirm`);
  await api("POST", `/tasks/${taskId}/definition-of-done/confirm`);
  await api("PUT", `/tasks/${taskId}/pipeline`, { pipelineId: "quick-fix" });
  expect(taskSchema.parse(await api("POST", `/tasks/${taskId}/ready`)).state).toBe("ready");
  return taskId;
}

async function untilConsultationOpens(api: Api, taskId: string) {
  return vi.waitFor(
    async () => {
      const threads = threadListSchema.parse(await api("GET", `/tasks/${taskId}/threads`));
      const opened = threads.find(({ consultation }) => consultation !== null);
      if (!opened) throw new Error("No Consultation yet.");
      return opened;
    },
    { timeout: STAGE_MS, interval: 1_000 },
  );
}

/** The Task may still read Waiting on you just after the answer, before Implement runs on. */
async function untilImplementEnds(api: Api, taskId: string): Promise<void> {
  const ended: readonly StageState[] = ["done", "failed", "stopped", "paused"];
  await vi.waitFor(
    async () => {
      const implement = (await stagesOf(api, taskId)).find(
        ({ stage }) => stage.key === "implement",
      );
      if (!implement || !ended.includes(implement.state)) throw new Error("Implement runs on.");
    },
    { timeout: STAGE_MS, interval: 5_000 },
  );
}

async function messagesOf(api: Api, threadId: string): Promise<Message[]> {
  return messageListSchema.parse(await api("GET", `/threads/${threadId}/messages`));
}

async function consultationMessages(
  api: Api,
  threads: readonly { readonly id: string; readonly consultation: unknown }[],
): Promise<Message[]> {
  const consultations = threads.filter(({ consultation }) => consultation !== null);
  return (await Promise.all(consultations.map(({ id }) => messagesOf(api, id)))).flat();
}

/**
 * Watches, every few seconds while sessions run, the sessions' folders for their private MCP config
 * files and every process's command line for a Server value.
 */
class SessionWatch {
  private readonly configFiles = new Set<string>();
  private commandLinesWithValue = 0;
  private timer: NodeJS.Timeout | undefined;
  private looking: Promise<void> = Promise.resolve();

  constructor(
    private readonly dataFolder: string,
    private readonly values: readonly string[],
  ) {}

  start(): void {
    this.timer = setInterval(() => {
      this.looking = this.looking.then(() => this.look()).catch(() => undefined);
    }, WATCH_MS);
  }

  stop(): void {
    clearInterval(this.timer);
  }

  async report(): Promise<{
    readonly configFiles: string[];
    readonly configFilesLeft: string[];
    readonly commandLinesWithValue: number;
    readonly lines: string[];
  }> {
    await this.looking;
    const configFiles = [...this.configFiles];
    const configFilesLeft = await this.configFilesNow();
    return {
      configFiles,
      configFilesLeft,
      commandLinesWithValue: this.commandLinesWithValue,
      lines: [
        `MCP config files seen while running: ${configFiles.length} (${configFiles.join(", ")})`,
        `MCP config files left after: ${configFilesLeft.length}`,
        `Process command lines holding a Server value: ${this.commandLinesWithValue}`,
      ],
    };
  }

  private async look(): Promise<void> {
    for (const file of await this.configFilesNow()) this.configFiles.add(file);
    this.commandLinesWithValue += await commandLinesHolding(this.values);
  }

  private async configFilesNow(): Promise<string[]> {
    const sessions = join(this.dataFolder, "sessions");
    const found: string[] = [];
    for (const session of await readdir(sessions).catch(() => [])) {
      for (const file of await readdir(join(sessions, session)).catch(() => [])) {
        if (file.startsWith("mcp-config-")) found.push(`${session}/${file}`);
      }
    }
    return found;
  }
}
