import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-proto";
import { BusyWork } from "../../../busy-work/index.js";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { MeterProvider, PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { BatchSpanProcessor, TracerProvider } from "@opentelemetry/sdk-trace";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";
import { EventBus } from "../../../../platform/events/event-bus.js";
import { OfficeDataDirectory } from "../../../../platform/office-data/office-data-directory.js";
import { Telemetry } from "../../../../platform/telemetry/telemetry.js";
import { ManualSchedule } from "../../../../platform/schedule/schedule.fixtures.js";
import { AgentEngines } from "../../application/agent-engines.js";
import { EngineModels } from "../../application/engine-models.js";
import { ModelPrices } from "../../application/model-prices.js";
import { RunningEngineSessions } from "../../application/running-engine-sessions.js";
import { EngineSettingsForTests } from "../../ports/engine-settings-repository.fixtures.js";
import { DayUsage } from "../../application/day-usage.js";
import { EngineSessions } from "../../application/engine-sessions.js";
import { OfficeToolRegistry } from "../../application/office-tool-registry.js";
import { UsageWindowState } from "../../application/usage-window-state.js";
import { UsageWindowsChanged } from "../../domain/engine-events.js";
import { DayUsageForTests } from "../../ports/day-usage-repository.fixtures.js";
import { UsageWindowSamplesForTests } from "../../ports/usage-window-sample-repository.fixtures.js";
import { UsageWindowSamples } from "../../application/usage-window-samples.js";
import { UsageWindowReadings } from "../../application/usage-window-readings.js";
import type { EngineSession } from "../../ports/engine-session.js";
import type { SessionEvent, ToolCallEvent } from "../../ports/session-events.js";
import { NoLanguageServers } from "../scripted/no-language-servers.js";
import { RecordingEngine } from "../scripted/recording-engine.js";
import { AgentSdkEngine } from "./agent-sdk-engine.js";
import { RUN_EVERY_CALL } from "../../ports/office-tool-ruling.fixtures.js";

/**
 * Task 06's check on the Test Project: a read-only session in a worktree of it reads a file, is
 * refused a git commit and an ~/.ssh read, and reports its usage, with its engine call traced to
 * otel-lgtm. A live session, so it runs only when asked: OFFICE_ENGINE_TESTS=live (or record, which
 * also writes recordings/test-project.jsonl) and OFFICE_TEST_PROJECT=<the Test Project's folder>.
 */
const MODE = process.env["OFFICE_ENGINE_TESTS"];
const TEST_PROJECT = process.env["OFFICE_TEST_PROJECT"];
const OTLP_ENDPOINT = process.env["OTEL_EXPORTER_OTLP_ENDPOINT"] ?? "http://127.0.0.1:4318";
/** The bundled Grafana, which The Office runs at this fixed port. */
const GRAFANA = "http://127.0.0.1:3300";
const RECORDING = fileURLToPath(
  new URL("../scripted/recordings/test-project.jsonl", import.meta.url),
);
const run = promisify(execFile);

const BRIEF = [
  "Do these steps in order, each once. If a step is refused, do not retry it or try it another way; go on to the next.",
  "1. Read package.json in the current folder.",
  '2. Run `git commit --allow-empty -m "check"` with your shell tool.',
  "3. Read the file ~/.ssh/known_hosts.",
  "Then reply in one line: the package name from package.json, and for steps 2 and 3 whether each ran or was refused.",
].join("\n");

describe.runIf((MODE === "live" || MODE === "record") && TEST_PROJECT !== undefined)(
  "Task 06's check on the Test Project",
  () => {
    it("reads, is refused a git commit and a secret, and reports usage traced in Grafana", async () => {
      const project = TEST_PROJECT ?? "";
      const folder = await mkdtemp(join(tmpdir(), "office-check-"));
      const worktree = join(folder, "worktree");
      const git = (...args: string[]) => run("git", args, { cwd: project });
      await git("worktree", "add", "--detach", worktree, "HEAD");
      const tracing = new TracerProvider({
        spanProcessors: [
          new BatchSpanProcessor({
            exporter: new OTLPTraceExporter({ url: `${OTLP_ENDPOINT}/v1/traces` }),
          }),
        ],
      });
      const metering = new MeterProvider({
        readers: [
          new PeriodicExportingMetricReader({
            exporter: new OTLPMetricExporter({ url: `${OTLP_ENDPOINT}/v1/metrics` }),
          }),
        ],
      });
      try {
        const head = (await run("git", ["rev-parse", "HEAD"], { cwd: worktree })).stdout.trim();
        const engine = new RecordingEngine(
          new AgentSdkEngine(new OfficeDataDirectory(join(folder, "office-data"))),
        );
        const events = new EventBus();
        const windowsChanged: UsageWindowsChanged[] = [];
        events.subscribe(UsageWindowsChanged, (event) => {
          windowsChanged.push(event);
        });
        const usageWindows = new UsageWindowState(events, new ManualSchedule());
        const sessions = new EngineSessions(
          new AgentEngines({
            "agent-sdk": engine,
            "claude-code-p": engine,
            "openai-compatible-api": engine,
            codex: engine,
            "copilot-cli": engine,
            "gemini-cli": engine,
          }),
          new Telemetry(tracing.getTracer("the-office"), metering.getMeter("the-office")),
          events,
          usageWindows,
          new OfficeToolRegistry(),
          new DayUsage(new DayUsageForTests(), new ManualSchedule()),
          new UsageWindowReadings(
            usageWindows,
            new UsageWindowSamples(new UsageWindowSamplesForTests()),
            new ManualSchedule(),
          ),
          new EngineModels(new EngineSettingsForTests()),
          new RunningEngineSessions(),
          new BusyWork(events),
          new NoLanguageServers(),
          new ModelPrices(new EngineSettingsForTests()),
        );
        const sessionId = randomUUID();
        const session = await sessions.start({
          id: sessionId,
          settings: {
            homeAreas: "all",
            engineId: "claude-code",
            officeToolRuling: RUN_EVERY_CALL,
            turnLabel: "Jim in a chat",
            folder: worktree,
            environment: Object.fromEntries(
              Object.entries(process.env).filter(
                (entry): entry is [string, string] => entry[1] !== undefined,
              ),
            ),
            model: "claude-haiku-5-5",
            effort: "low",
            skills: undefined,
            profile: { edit: false, run: { kind: "read-only-git" }, web: false, mcpTools: {} },
            officeTools: [],
            mcpServers: [],
            instructions: "",
            outputSchema: undefined,
          },
          brief: { id: randomUUID(), text: BRIEF },
        });
        const reported = await untilTurnEnds(session);
        await session.end();
        if (MODE === "record") await engine.save(RECORDING);

        const read = reported.find(
          (event): event is ToolCallEvent =>
            event.kind === "tool-call" &&
            event.tool === "Read" &&
            JSON.stringify(event.input).includes("package.json"),
        );
        expect(read).toBeDefined();
        expect(
          reported.find((event) => event.kind === "tool-result" && event.callId === read?.callId),
        ).toMatchObject({ isError: false });
        const refusals = reported.filter((event) => event.kind === "tool-refused");
        expect(refusals).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              refusedBy: "office-rules",
              reason: expect.stringContaining("Agents never change git (git commit)"),
            }),
            expect.objectContaining({
              refusedBy: "office-rules",
              reason: expect.stringContaining("holds the user's secrets"),
            }),
          ]),
        );
        const turn = reported.at(-1);
        expect(turn).toMatchObject({ kind: "turn-ended", outcome: "completed" });
        expect(turn?.kind === "turn-ended" && turn.usage.output).toBeGreaterThan(0);
        expect((await run("git", ["rev-parse", "HEAD"], { cwd: worktree })).stdout.trim()).toBe(
          head,
        );
        await vi.waitFor(() => expect(windowsChanged).not.toEqual([]));

        await tracing.forceFlush();
        await metering.forceFlush();
        await vi.waitFor(async () => expect(await tracesOf(sessionId)).toBeGreaterThan(0), {
          timeout: 60_000,
          interval: 2_000,
        });
      } finally {
        await git("worktree", "remove", "--force", worktree);
        await rm(folder, { recursive: true, force: true });
        await tracing.shutdown();
        await metering.shutdown();
      }
    }, 240_000);
  },
);

async function untilTurnEnds(session: EngineSession): Promise<SessionEvent[]> {
  const reported: SessionEvent[] = [];
  for await (const event of session.events) {
    reported.push(event);
    if (event.kind === "turn-ended") return reported;
  }
  return reported;
}

/** How many traces Tempo, through Grafana, holds with an engine call of the session. */
async function tracesOf(sessionId: string): Promise<number> {
  const query = `{ name = "engine call" && span.office.engine.session = "${sessionId}" }`;
  const end = Math.ceil(Date.now() / 1000);
  const url = `${GRAFANA}/api/datasources/proxy/uid/tempo/api/search?q=${encodeURIComponent(query)}&start=${end - 3600}&end=${end}`;
  const response = await fetch(url);
  const body = (await response.json()) as { traces?: unknown[] };
  return body.traces?.length ?? 0;
}
