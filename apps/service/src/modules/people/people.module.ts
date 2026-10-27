import { Module } from "@nestjs/common";
import { EngineModule } from "../engine/index.js";
import { SkillsModule } from "../skills/index.js";
import { MemoryController } from "./adapters/http/memory.controller.js";
import { RolesController } from "./adapters/http/roles.controller.js";
import { PeopleOfficeTools } from "./adapters/office-tools/people-office-tools.js";
import { PostgresMemoryRepository } from "./adapters/postgres/postgres-memory-repository.js";
import { PostgresRoleRepository } from "./adapters/postgres/postgres-role-repository.js";
import { RoleWebEvents } from "./adapters/websocket/role-web-events.js";
import { MemoryService } from "./application/memory-service.js";
import { RoleCards } from "./application/role-cards.js";
import { RoleService } from "./application/role-service.js";
import { MemoryRepository } from "./ports/memory-repository.js";
import { RoleRepository } from "./ports/role-repository.js";

@Module({
  // A Role card names its skills, which the Skills module keeps; chats read People through an
  // Office tool on the Engine's registry.
  imports: [SkillsModule, EngineModule],
  controllers: [RolesController, MemoryController],
  providers: [
    { provide: RoleRepository, useClass: PostgresRoleRepository },
    { provide: MemoryRepository, useClass: PostgresMemoryRepository },
    RoleService,
    MemoryService,
    RoleCards,
    RoleWebEvents,
    PeopleOfficeTools,
  ],
  exports: [RoleCards, RoleService, MemoryService],
})
export class PeopleModule {}
