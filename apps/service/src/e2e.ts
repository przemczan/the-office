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
      EngineModule,
      OPENAI_COMPATIBLE_API_CAPABILITIES,
      readRecording,
      ScriptedEngine,
      ScriptedEngineModule,
      StandInClaudeCodeAccounts,
    } = await import("./modules/engine/index.js");
    const { UpdateSystem } = await import("./modules/office-updates/index.js");
    const { Schedule } = await import("./platform/schedule/schedule.js");
    const { TimerSchedule } = await import("./platform/schedule/timer-schedule.js");
    const { HostKeyScanner } = await import("./platform/git-identity/host-key-scanner.js");
    const { hostKeyOf } = await import("./platform/git-identity/host-keys.js");
    const { OfficeLogger } = await import("./platform/telemetry/office-logger.js");
    const scannedKey = hostKeyOf(hostKey);
    if (!scannedKey) throw new Error(`OFFICE_E2E_HOST_KEY is no ssh public key: ${hostKey}`);
    const scanner: InstanceType<typeof HostKeyScanner> = {
      scan: () => Promise.resolve([scannedKey]),
    };
    const engine = new ScriptedEngine(await readRecording(scripts));
    // No end-to-end session runs on the OpenAI-compatible API; its stand-in only declares what the
    // engine can't do, for the Role card to name.
    const apiEngine = new ScriptedEngine([], OPENAI_COMPATIBLE_API_CAPABILITIES);
    const moduleRef = await Test.createTestingModule({ imports: [appModule] })
      .overrideModule(EngineModule)
      .useModule(
        ScriptedEngineModule.register({
          "agent-sdk": engine,
          "claude-code-p": engine,
          "openai-compatible-api": apiEngine,
        }),
      )
      .overrideProvider(ClaudeCodeAccounts)
      .useValue(new StandInClaudeCodeAccounts())
      .overrideProvider(Schedule)
      .useFactory({ factory: () => new TimerSchedule(E2E_DAY_MS) })
      .overrideProvider(HostKeyScanner)
      .useValue(scanner)
      // Settings › Updates is tested on both systems, though Windows doesn't offer updating.
      .overrideProvider(UpdateSystem)
      .useValue({ refusal: undefined })
      // The testing module's own logger shows errors alone; the service logs as main.ts's does.
      .setLogger(new OfficeLogger())
      .compile();
    return moduleRef.createNestApplication({ ...HTTP_APPLICATION_OPTIONS, abortOnError: false });
  },
  officeCheckout,
);
