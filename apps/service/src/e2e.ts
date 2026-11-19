import type { Server } from "node:http";
import type { Request, Response } from "express";
import { z } from "zod";
import { launch } from "./launch.js";
import { HTTP_APPLICATION_OPTIONS } from "./platform/http/configure-http.js";

// The service as `main.ts` runs it, on a scripted engine: the end-to-end tests' sessions replay the
// scripts in OFFICE_ENGINE_SCRIPTS, one per session opened, so they make no model call.
const scripts = process.env["OFFICE_ENGINE_SCRIPTS"];
// The Office's own checkout the end-to-end service updates, a clone behind its upstream.
const officeCheckout = process.env["OFFICE_E2E_CHECKOUT"];
// No ssh server runs in the end-to-end tests: every host scanned presents this one key.
const hostKey = process.env["OFFICE_E2E_HOST_KEY"];
/** A day in the end-to-end service: short, so a test sees the daily jobs find what it changed. */
const E2E_DAY_MS = 2000;
/**
 * Longer than any pause in a test: Playwright's request client keeps a connection until the service
 * closes it, so a request sent as that happens fails with ECONNRESET.
 */
const E2E_KEEP_ALIVE_MS = 10 * 60 * 1000;
/** `POST` it to release a scripted session's `wait` step (`ScriptedSession.reach`). */
const E2E_MARK_PATH = "/api/e2e/marks/:mark";
/**
 * `POST` it to approve the Sign in under way on a Codex engine, as the user would on the device
 * page (`StandInCodexAccounts.approve`): 204, or 404 with none under way.
 */
const E2E_CODEX_APPROVAL_PATH = "/api/e2e/codex-sign-ins/:engineId/approval";
/**
 * `POST` it to enter the code of the Sign in under way on a Copilot CLI engine, as the user would on
 * GitHub's page (`StandInCopilotCliAccounts.approve`): 204, or 404 with none under way.
 */
const E2E_COPILOT_CLI_APPROVAL_PATH = "/api/e2e/copilot-cli-sign-ins/:engineId/approval";
/**
 * `POST` it to set what the scripted Grafana holds for the full stats, replacing all it held: each
 * part absent answers empty (the data sources both there), and a `failure` answers every read
 * (`ScriptedStatsSource`). 204.
 */
const E2E_STATS_SOURCE_PATH = "/api/e2e/stats-source";
const e2ePointsSchema = z.array(z.object({ at: z.coerce.date(), value: z.number() }));
const e2eSpendSchema = { tokens: z.number(), estimatedCostUsd: z.number() };
const e2eStatsSourceSchema = z.object({
  failure: z
    .discriminatedUnion("kind", [
      z.object({ kind: z.literal("unreachable"), problem: z.string() }),
      z.object({ kind: z.literal("rejected") }),
    ])
    .optional(),
  dataSources: z
    .object({ prometheus: z.string().optional(), loki: z.string().optional() })
    .optional(),
  usage: z
    .object({
      tokens: z.array(z.object({ name: z.string(), points: e2ePointsSchema })),
      estimatedCostUsd: z.array(z.object({ name: z.string(), points: e2ePointsSchema })),
    })
    .optional(),
  costliest: z
    .object({
      tasks: z.array(
        z.object({
          taskId: z.string(),
          ...e2eSpendSchema,
          runs: z.array(
            z.object({
              stageName: z.string(),
              stageRun: z.string(),
              firstAt: z.coerce.date(),
              ...e2eSpendSchema,
            }),
          ),
        }),
      ),
      initiatives: z.array(
        z.object({
          initiativeId: z.string(),
          ...e2eSpendSchema,
          tasks: z.array(z.object({ taskId: z.string(), ...e2eSpendSchema })),
        }),
      ),
    })
    .optional(),
  windows: z
    .array(
      z.object({
        engineId: z.string(),
        window: z.enum(["five_hour", "seven_day"]),
        points: e2ePointsSchema,
      }),
    )
    .optional(),
});
if (!scripts) throw new Error("The end-to-end service needs OFFICE_ENGINE_SCRIPTS.");
if (!hostKey) throw new Error("The end-to-end service needs OFFICE_E2E_HOST_KEY.");
if (!officeCheckout) throw new Error("The end-to-end service needs OFFICE_E2E_CHECKOUT.");

await launch(
  "built",
  async (appModule) => {
    // Loaded once telemetry has started, as launch.ts asks.
    const { Test } = await import("@nestjs/testing");
    const {
      ClaudeCodeAccounts,
      CODEX_CAPABILITIES,
      CodexAccounts,
      CopilotCliAccounts,
      EngineModule,
      OPENAI_COMPATIBLE_API_CAPABILITIES,
      readRecording,
      ScriptedEngine,
      ScriptedEngineModule,
      StandInClaudeCodeAccounts,
      StandInCodexAccounts,
      StandInCopilotCliAccounts,
      COPILOT_CLI_CAPABILITIES,
    } = await import("./modules/engine/index.js");
    const { UpdateSystem } = await import("./modules/office-updates/index.js");
    const { ScriptedStatsSource, StatsSource } = await import("./modules/telemetry/index.js");
    const { Schedule } = await import("./platform/schedule/schedule.js");
    const { TimerSchedule } = await import("./platform/schedule/timer-schedule.js");
    const { HostKeyScanner } = await import("./platform/git-identity/host-key-scanner.js");
    const { hostKeyOf } = await import("./platform/git-identity/host-keys.js");
    const { OfficeLogger } = await import("./platform/telemetry/office-logger.js");
    const { BundledGrafana } =
      await import("./platform/telemetry/bundled-grafana/bundled-grafana.js");
    const { ScriptedBundledGrafana } =
      await import("./platform/telemetry/bundled-grafana/scripted-bundled-grafana.js");
    const scannedKey = hostKeyOf(hostKey);
    if (!scannedKey) throw new Error(`OFFICE_E2E_HOST_KEY is no ssh public key: ${hostKey}`);
    const scanner: InstanceType<typeof HostKeyScanner> = {
      scan: () => Promise.resolve([scannedKey]),
    };
    const engine = new ScriptedEngine(await readRecording(scripts));
    // No end-to-end session runs on the OpenAI-compatible API, Codex or the Copilot CLI; their
    // stand-ins only declare what the engine can't do, for the Role card to name.
    const apiEngine = new ScriptedEngine([], OPENAI_COMPATIBLE_API_CAPABILITIES);
    const codexEngine = new ScriptedEngine([], CODEX_CAPABILITIES);
    const copilotCliEngine = new ScriptedEngine([], COPILOT_CLI_CAPABILITIES);
    const codexAccounts = new StandInCodexAccounts();
    const copilotCliAccounts = new StandInCopilotCliAccounts();
    const statsSource = new ScriptedStatsSource();
    const moduleRef = await Test.createTestingModule({ imports: [appModule] })
      .overrideModule(EngineModule)
      .useModule(
        ScriptedEngineModule.register({
          "agent-sdk": engine,
          "claude-code-p": engine,
          "openai-compatible-api": apiEngine,
          codex: codexEngine,
          "copilot-cli": copilotCliEngine,
        }),
      )
      .overrideProvider(ClaudeCodeAccounts)
      .useValue(new StandInClaudeCodeAccounts())
      .overrideProvider(CodexAccounts)
      .useValue(codexAccounts)
      .overrideProvider(CopilotCliAccounts)
      .useValue(copilotCliAccounts)
      .overrideProvider(Schedule)
      .useFactory({ factory: () => new TimerSchedule(E2E_DAY_MS) })
      .overrideProvider(HostKeyScanner)
      .useValue(scanner)
      // Settings › Updates is tested on both systems, though Windows doesn't offer updating.
      .overrideProvider(UpdateSystem)
      .useValue({ refusal: undefined })
      // No end-to-end test starts or stops a real Grafana container.
      .overrideProvider(BundledGrafana)
      .useValue(new ScriptedBundledGrafana())
      // Nor reads one: the full stats read what the test sets at E2E_STATS_SOURCE_PATH.
      .overrideProvider(StatsSource)
      .useValue(statsSource)
      // The testing module's own logger shows errors alone; the service logs as main.ts's does.
      .setLogger(new OfficeLogger())
      .compile();
    const app = moduleRef.createNestApplication({
      ...HTTP_APPLICATION_OPTIONS,
      abortOnError: false,
    });
    const server: Server = app.getHttpServer();
    server.keepAliveTimeout = E2E_KEEP_ALIVE_MS;
    // The scripted sessions run in here, and a test reaches the service over HTTP alone: this
    // test-only route lets every session's replay go on past its `wait` step with that mark.
    app
      .getHttpAdapter()
      .post(E2E_MARK_PATH, (request: Request<{ mark: string }>, response: Response) => {
        for (const session of engine.sessions) session.reach(request.params.mark);
        response.status(204).end();
      });
    app
      .getHttpAdapter()
      .post(
        E2E_CODEX_APPROVAL_PATH,
        (request: Request<{ engineId: string }>, response: Response) => {
          response.status(codexAccounts.approve(request.params.engineId) ? 204 : 404).end();
        },
      );
    app
      .getHttpAdapter()
      .post(
        E2E_COPILOT_CLI_APPROVAL_PATH,
        (request: Request<{ engineId: string }>, response: Response) => {
          response.status(copilotCliAccounts.approve(request.params.engineId) ? 204 : 404).end();
        },
      );
    app.getHttpAdapter().post(E2E_STATS_SOURCE_PATH, (request: Request, response: Response) => {
      jsonBodyOf(request)
        .then((body) => e2eStatsSourceSchema.parse(body))
        .then(
          (stats) => {
            statsSource.set(stats);
            return response.status(204).end();
          },
          (error: unknown) =>
            response.status(400).json({
              message: error instanceof z.ZodError ? z.prettifyError(error) : String(error),
            }),
        );
    });
    return app;
  },
  officeCheckout,
);

/** The request's JSON body, read here when no body parser ran before this route. */
async function jsonBodyOf(request: Request): Promise<unknown> {
  if (request.body !== undefined) return request.body;
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk as Uint8Array));
  const text = Buffer.concat(chunks).toString("utf8");
  return text === "" ? {} : JSON.parse(text);
}
