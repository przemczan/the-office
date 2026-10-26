import { launch } from "./launch.js";
import { HTTP_APPLICATION_OPTIONS } from "./platform/http/configure-http.js";

// The service as `main.ts` runs it, on a scripted engine: the end-to-end tests' sessions replay the
// scripts in OFFICE_ENGINE_SCRIPTS, one per session opened, so they make no model call.
const scripts = process.env["OFFICE_ENGINE_SCRIPTS"];
if (!scripts) throw new Error("The end-to-end service needs OFFICE_ENGINE_SCRIPTS.");

await launch("built", async (appModule) => {
  // Loaded once telemetry has started, as launch.ts asks.
  const { Test } = await import("@nestjs/testing");
  const { EngineModule, readRecording, ScriptedEngine, ScriptedEngineModule } =
    await import("./modules/engine/index.js");
  const engine = new ScriptedEngine(await readRecording(scripts));
  const moduleRef = await Test.createTestingModule({ imports: [appModule] })
    .overrideModule(EngineModule)
    .useModule(ScriptedEngineModule.register(engine))
    .compile();
  return moduleRef.createNestApplication({ ...HTTP_APPLICATION_OPTIONS, abortOnError: false });
});
