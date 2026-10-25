import { Module } from "@nestjs/common";
import { SkillsModule } from "../skills/index.js";
import { RolesController } from "./adapters/http/roles.controller.js";
import { PostgresRoleRepository } from "./adapters/postgres/postgres-role-repository.js";
import { RoleWebEvents } from "./adapters/websocket/role-web-events.js";
import { RoleCards } from "./application/role-cards.js";
import { RoleService } from "./application/role-service.js";
import { RoleRepository } from "./ports/role-repository.js";

@Module({
  // A Role card names its skills, which the Skills module keeps.
  imports: [SkillsModule],
  controllers: [RolesController],
  providers: [
    { provide: RoleRepository, useClass: PostgresRoleRepository },
    RoleService,
    RoleCards,
    RoleWebEvents,
  ],
  exports: [RoleCards],
})
export class PeopleModule {}
