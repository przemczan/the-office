import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import { startTestApplication } from "../../../test/test-application.js";
import { EventsModule } from "../../platform/events/events.module.js";
import { OfficeDataModule } from "../../platform/office-data/office-data.module.js";
import { TelemetryModule } from "../../platform/telemetry/telemetry.module.js";
import { EventStreamModule } from "../../platform/websocket/event-stream.module.js";
import { EngineModule, ScriptedEngine, ScriptedEngineModule } from "../engine/index.js";
import { McpServerOfficeActionsModule } from "./mcp-server-office-actions.module.js";
import { McpServersModule } from "./mcp-servers.module.js";

/**
 * The library with its routes and its Office actions, on the scripted engine that holds the
 * Engine's Office tool registry, as the tests of both the library's routes and its tools boot it.
 */
export async function startMcpServersApplication(): Promise<{
  app: INestApplication;
  url: string;
}> {
  const officeData = await mkdtemp(join(tmpdir(), "office-mcp-servers-"));
  return startTestApplication({
    database: true,
    imports: [
      EventsModule,
      EventStreamModule,
      TelemetryModule,
      OfficeDataModule.forRoot(officeData),
      McpServersModule,
      McpServerOfficeActionsModule,
    ],
    moduleOverrides: [
      { module: EngineModule, useModule: ScriptedEngineModule.register(new ScriptedEngine([])) },
    ],
  });
}
