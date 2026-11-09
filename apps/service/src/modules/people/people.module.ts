import { Module, RequestMethod, type MiddlewareConsumer, type NestModule } from "@nestjs/common";
import { IMAGE_UPLOAD_BYTES } from "@the-office/contracts";
import { uploadBody } from "../../platform/http/upload-body.js";
import { ImageFolder } from "../../platform/images/image-folder.js";
import { OfficeDataDirectory } from "../../platform/office-data/office-data-directory.js";
import { EngineModule } from "../engine/index.js";
import { McpServersModule } from "../mcp-servers/index.js";
import { SkillsModule } from "../skills/index.js";
import { AvatarsController } from "./adapters/http/avatars.controller.js";
import { MemoryController } from "./adapters/http/memory.controller.js";
import { RolesController } from "./adapters/http/roles.controller.js";
import { PeopleOfficeTools } from "./adapters/office-tools/people-office-tools.js";
import { PostgresMemoryRepository } from "./adapters/postgres/postgres-memory-repository.js";
import { PostgresRoleRepository } from "./adapters/postgres/postgres-role-repository.js";
import { RoleWebEvents } from "./adapters/websocket/role-web-events.js";
import { MemoryService } from "./application/memory-service.js";
import { PersonAvatars } from "./application/person-avatars.js";
import { RoleCards } from "./application/role-cards.js";
import { RoleOverrideChecks } from "./application/role-override-checks.js";
import { RoleOverrideMoves } from "./application/role-override-moves.js";
import { PersonRecords } from "./application/person-records.js";
import { RoleService } from "./application/role-service.js";
import { AvatarFiles } from "./ports/avatar-files.js";
import { MemoryRepository } from "./ports/memory-repository.js";
import { RoleRepository } from "./ports/role-repository.js";

@Module({
  // A Role card names its skills and MCP servers, which the Skills and MCP servers modules keep;
  // chats read People through an Office tool on the Engine's registry.
  imports: [SkillsModule, McpServersModule, EngineModule],
  controllers: [RolesController, AvatarsController, MemoryController],
  providers: [
    { provide: RoleRepository, useClass: PostgresRoleRepository },
    { provide: MemoryRepository, useClass: PostgresMemoryRepository },
    {
      provide: AvatarFiles,
      inject: [OfficeDataDirectory],
      useFactory: (officeData: OfficeDataDirectory) =>
        new ImageFolder(officeData.folder("avatars")),
    },
    RoleService,
    PersonAvatars,
    RoleOverrideChecks,
    RoleOverrideMoves,
    MemoryService,
    RoleCards,
    RoleWebEvents,
    PeopleOfficeTools,
    PersonRecords,
  ],
  exports: [RoleCards, RoleService, RoleOverrideChecks, MemoryService, PersonRecords],
})
export class PeopleModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(uploadBody(IMAGE_UPLOAD_BYTES))
      .forRoutes({ path: "roles/:key/avatar", method: RequestMethod.POST });
  }
}
