import { Module, RequestMethod, type MiddlewareConsumer, type NestModule } from "@nestjs/common";
import { IMAGE_UPLOAD_BYTES } from "@the-office/contracts";
import { uploadBody } from "../../platform/http/upload-body.js";
import { ImageFolder } from "../../platform/images/image-folder.js";
import { OfficeDataDirectory } from "../../platform/office-data/office-data-directory.js";
import { EngineModule } from "../engine/index.js";
import { McpServersModule } from "../mcp-servers/index.js";
import { SkillsModule } from "../skills/index.js";
import { AvatarsController } from "./adapters/http/avatars.controller.js";
import { DutiesController } from "./adapters/http/duties.controller.js";
import { MemoryController } from "./adapters/http/memory.controller.js";
import { RolesController } from "./adapters/http/roles.controller.js";
import { PeopleOfficeTools } from "./adapters/office-tools/people-office-tools.js";
import { PostgresDutyRepository } from "./adapters/postgres/postgres-duty-repository.js";
import { PeopleEarlierRecords } from "./adapters/postgres/people-earlier-records.js";
import { PostgresMemoryRepository } from "./adapters/postgres/postgres-memory-repository.js";
import { PostgresOfficeSetupRepository } from "./adapters/postgres/postgres-office-setup-repository.js";
import { PostgresRoleRepository } from "./adapters/postgres/postgres-role-repository.js";
import { RoleWebEvents } from "./adapters/websocket/role-web-events.js";
import { AuthorityMoveOver } from "./application/authority-move-over.js";
import { Duties } from "./application/duties.js";
import { DutyChangeChecks } from "./application/duty-change-checks.js";
import { EngineSettingsMoveOver } from "./application/engine-settings-move-over.js";
import { MemoryService } from "./application/memory-service.js";
import { MemoryTaskTitles } from "./application/memory-task-titles.js";
import { OfficeSetup } from "./application/office-setup.js";
import { PersonAvatars } from "./application/person-avatars.js";
import { RoleCards } from "./application/role-cards.js";
import { PersonRecords } from "./application/person-records.js";
import { RoleService } from "./application/role-service.js";
import { AvatarFiles } from "./ports/avatar-files.js";
import { DutyRepository } from "./ports/duty-repository.js";
import { MemoryRepository } from "./ports/memory-repository.js";
import { OfficeSetupRepository } from "./ports/office-setup-repository.js";
import { RoleRepository } from "./ports/role-repository.js";

@Module({
  // A Role card names its skills and MCP servers, which the Skills and MCP servers modules keep;
  // chats read People through an Office tool on the Engine's registry.
  imports: [SkillsModule, McpServersModule, EngineModule],
  controllers: [RolesController, AvatarsController, MemoryController, DutiesController],
  providers: [
    { provide: RoleRepository, useClass: PostgresRoleRepository },
    { provide: MemoryRepository, useClass: PostgresMemoryRepository },
    { provide: DutyRepository, useClass: PostgresDutyRepository },
    { provide: OfficeSetupRepository, useClass: PostgresOfficeSetupRepository },
    {
      provide: AvatarFiles,
      inject: [OfficeDataDirectory],
      useFactory: (officeData: OfficeDataDirectory) =>
        new ImageFolder(officeData.folder("avatars")),
    },
    RoleService,
    Duties,
    DutyChangeChecks,
    OfficeSetup,
    PersonAvatars,
    MemoryService,
    MemoryTaskTitles,
    RoleCards,
    RoleWebEvents,
    PeopleOfficeTools,
    PersonRecords,
    PeopleEarlierRecords,
    EngineSettingsMoveOver,
    AuthorityMoveOver,
  ],
  exports: [
    RoleCards,
    RoleService,
    MemoryService,
    MemoryTaskTitles,
    PersonRecords,
    Duties,
    DutyRepository,
    DutyChangeChecks,
    OfficeSetup,
    OfficeSetupRepository,
  ],
})
export class PeopleModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(uploadBody(IMAGE_UPLOAD_BYTES))
      .forRoutes({ path: "roles/:key/avatar", method: RequestMethod.POST });
  }
}
