import { Global, Module } from "@nestjs/common";
import { DATABASE_QUERY_OBSERVER } from "../database/database-pool.js";
import { ScheduleModule } from "../schedule/schedule.module.js";
import { WorkstationModule } from "../workstation/workstation.module.js";
import { NodeOfficeProcess, OfficeProcess } from "./office-process.js";
import { SystemHealthRecorder } from "./system-health-recorder.js";

/**
 * The System health recorder, one for the whole service. Global, so the database pool finds it as
 * its query observer, `configureHttp` puts its request middleware first, and the app module binds
 * Telemetry's port to it; an app without it, such as most tests', records nothing.
 */
@Global()
@Module({
  imports: [ScheduleModule, WorkstationModule],
  providers: [
    SystemHealthRecorder,
    { provide: OfficeProcess, useClass: NodeOfficeProcess },
    { provide: DATABASE_QUERY_OBSERVER, useExisting: SystemHealthRecorder },
  ],
  exports: [SystemHealthRecorder, DATABASE_QUERY_OBSERVER],
})
export class SystemHealthModule {}
