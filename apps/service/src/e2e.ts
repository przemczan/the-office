import { launch } from "./launch.js";
import { HTTP_APPLICATION_OPTIONS } from "./platform/http/configure-http.js";

// The service as `main.ts` runs it, on a scripted engine: the end-to-end tests' sessions replay the
// scripts in OFFICE_ENGINE_SCRIPTS, one per session opened, so they make no model call.
const scripts = process.env["OFFICE_ENGINE_SCRIPTS"];
/** A day in the end-to-end service: short, so a test sees the daily jobs find what it changed. */
const E2E_DAY_MS = 2000;
if (!scripts) throw new Error("The end-to-end service needs OFFICE_ENGINE_SCRIPTS.");

await launch("built", async (appModule) => {
  // Loaded once telemetry has started, as launch.ts asks.
  const { Test } = await import("@nestjs/testing");
  const { EngineModule, readRecording, ScriptedEngine, ScriptedEngineModule } =
    await import("./modules/engine/index.js");
  const { Schedule } = await import("./platform/schedule/schedule.js");
  const { TimerSchedule } = await import("./platform/schedule/timer-schedule.js");
  const engine = new ScriptedEngine(await readRecording(scripts));
  const moduleRef = await Test.createTestingModule({ imports: [appModule] })
    .overrideModule(EngineModule)
    .useModule(ScriptedEngineModule.register(engine))
    .overrideProvider(Schedule)
    .useFactory({ factory: () => new TimerSchedule(E2E_DAY_MS) })
    .compile();
  return moduleRef.createNestApplication({ ...HTTP_APPLICATION_OPTIONS, abortOnError: false });
});
