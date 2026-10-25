import { Module, type DynamicModule } from "@nestjs/common";
import type { OfficeConfig } from "./platform/config/office-config.js";
import { DatabaseModule } from "./platform/database/database.module.js";
import { EventsModule } from "./platform/events/events.module.js";
import { HealthModule } from "./platform/health/health.module.js";
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
        EventsModule,
        EventStreamModule,
        HealthModule,
        TelemetryModule,
        WebAppModule.register(webApp),
      ],
    };
  }
}
