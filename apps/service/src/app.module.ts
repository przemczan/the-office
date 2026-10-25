import { Module, type DynamicModule } from "@nestjs/common";
import { EngineModule } from "./modules/engine/index.js";
import { PipelineLibrary, PipelinesModule } from "./modules/pipelines/index.js";
import { ProjectsModule } from "./modules/projects/index.js";
import { SkillsModule } from "./modules/skills/index.js";
import type { OfficeConfig } from "./platform/config/office-config.js";
import { DatabaseModule } from "./platform/database/database.module.js";
import { EventsModule } from "./platform/events/events.module.js";
import { HealthModule } from "./platform/health/health.module.js";
import { OfficeDataModule } from "./platform/office-data/office-data.module.js";
import { TelemetryModule } from "./platform/telemetry/telemetry.module.js";
import { WebAppModule, type WebAppOptions } from "./platform/web-app/web-app.module.js";
import { EventStreamModule } from "./platform/websocket/event-stream.module.js";

@Module({})
export class AppModule {
  static register(config: OfficeConfig, webApp: WebAppOptions): DynamicModule {
    return {
      module: AppModule,
      imports: [
        DatabaseModule.forRoot({ url: config.databaseUrl }),
        EngineModule,
        EventsModule,
        EventStreamModule,
        HealthModule,
        OfficeDataModule.forRoot(config.officeDataDirectory),
        PipelinesModule,
        ProjectsModule.register({ imports: [PipelinesModule], knownPipelines: PipelineLibrary }),
        SkillsModule,
        TelemetryModule,
        WebAppModule.register(webApp),
      ],
    };
  }
}
