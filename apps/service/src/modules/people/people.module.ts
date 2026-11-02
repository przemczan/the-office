import { Module } from "@nestjs/common";
import { EngineModule } from "../engine/index.js";
import { McpServersModule } from "../mcp-servers/index.js";
import { SkillsModule } from "../skills/index.js";
import { MemoryController } from "./adapters/http/memory.controller.js";
import { RolesController } from "./adapters/http/roles.controller.js";
import { PeopleOfficeTools } from "./adapters/office-tools/people-office-tools.js";
import { PostgresMemoryRepository } from "./adapters/postgres/postgres-memory-repository.js";
import { PostgresRoleRepository } from "./adapters/postgres/postgres-role-repository.js";
import { RoleWebEvents } from "./adapters/websocket/role-web-events.js";
import { MemoryService } from "./application/memory-service.js";
import { RoleCards } from "./application/role-cards.js";
import { RoleOverrideChecks } from "./application/role-override-checks.js";
import { RoleService } from "./application/role-service.js";
import { MemoryRepository } from "./ports/memory-repository.js";
import { RoleRepository } from "./ports/role-repository.js";

@Module({
  // A Role card names its skills and MCP servers, which the Skills and MCP servers modules keep;
  // chats read People through an Office tool on the Engine's registry.
  imports: [SkillsModule, McpServersModule, EngineModule],
  controllers: [RolesController, MemoryController],
  providers: [
    { provide: RoleRepository, useClass: PostgresRoleRepository },
    { provide: MemoryRepository, useClass: PostgresMemoryRepository },
    RoleService,
    RoleOverrideChecks,
    MemoryService,
    RoleCards,
    RoleWebEvents,
    PeopleOfficeTools,
  ],
  exports: [RoleCards, RoleService, RoleOverrideChecks, MemoryService],
})
export class PeopleModule {}
