import { Module, type DynamicModule } from "@nestjs/common";
import { ConversationsModule, StageThreads, ThreadService } from "./modules/conversations/index.js";
import { EngineModule } from "./modules/engine/index.js";
import { PeopleModule, RoleCards } from "./modules/people/index.js";
import {
  PipelineLibrary,
  PipelineLibraryModule,
  PipelinesModule,
} from "./modules/pipelines/index.js";
import {
  BaseCheckouts,
  ProjectService,
  ProjectsModule,
  TaskWorktrees,
} from "./modules/projects/index.js";
import { SkillsModule } from "./modules/skills/index.js";
import { TaskRecords, TaskService, WorkModule } from "./modules/work/index.js";
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
    // One instance, so every git change on a repository goes through the same locks.
    const projects = ProjectsModule.register({
      imports: [PipelineLibraryModule],
      knownPipelines: PipelineLibrary,
    });
    const conversations = ConversationsModule.register({
      imports: [projects],
      projectBases: BaseCheckouts,
    });
    const work = WorkModule.register({
      imports: [projects, conversations, PeopleModule, PipelineLibraryModule],
      knownProjects: ProjectService,
      projectWorktrees: TaskWorktrees,
      knownPeople: RoleCards,
      knownPipelines: PipelineLibrary,
      sessionPeople: ThreadService,
      sessionTasks: ThreadService,
      taskThreads: ThreadService,
    });
    return {
      module: AppModule,
      imports: [
        conversations,
        DatabaseModule.forRoot({ url: config.databaseUrl }),
        EngineModule,
        EventsModule,
        EventStreamModule,
        HealthModule,
        OfficeDataModule.forRoot(config.officeDataDirectory),
        PeopleModule,
        PipelinesModule.register({
          imports: [work, PeopleModule, conversations, projects],
          startedTasks: TaskService,
          taskRecords: TaskRecords,
          knownPeople: RoleCards,
          stageThreads: StageThreads,
          taskGit: TaskWorktrees,
        }),
        projects,
        SkillsModule,
        TelemetryModule,
        WebAppModule.register(webApp),
        work,
      ],
    };
  }
}
