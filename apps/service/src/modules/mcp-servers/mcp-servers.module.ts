import { Module } from "@nestjs/common";
import { McpClientModule } from "../../platform/mcp/mcp-client.module.js";
import { McpServersController } from "./adapters/http/mcp-servers.controller.js";
import { PostgresMcpServerRepository } from "./adapters/postgres/postgres-mcp-server-repository.js";
import { PostgresProjectServerValueRepository } from "./adapters/postgres/postgres-project-server-value-repository.js";
import { PostgresRoleMcpServerRepository } from "./adapters/postgres/postgres-role-mcp-server-repository.js";
import { PostgresSessionMcpServerRepository } from "./adapters/postgres/postgres-session-mcp-server-repository.js";
import { McpServerWebEvents } from "./adapters/websocket/mcp-server-web-events.js";
import { McpServerLibrary } from "./application/mcp-server-library.js";
import { ProjectServerValues } from "./application/project-server-values.js";
import { RoleMcpServers } from "./application/role-mcp-servers.js";
import { SessionMcpServers } from "./application/session-mcp-servers.js";
import { McpServerRepository } from "./ports/mcp-server-repository.js";
import { ProjectServerValueRepository } from "./ports/project-server-value-repository.js";
import { RoleMcpServerRepository } from "./ports/role-mcp-server-repository.js";
import { SessionMcpServerRepository } from "./ports/session-mcp-server-repository.js";

@Module({
  imports: [McpClientModule],
  controllers: [McpServersController],
  providers: [
    { provide: McpServerRepository, useClass: PostgresMcpServerRepository },
    { provide: RoleMcpServerRepository, useClass: PostgresRoleMcpServerRepository },
    { provide: ProjectServerValueRepository, useClass: PostgresProjectServerValueRepository },
    { provide: SessionMcpServerRepository, useClass: PostgresSessionMcpServerRepository },
    McpServerLibrary,
    RoleMcpServers,
    ProjectServerValues,
    SessionMcpServers,
    McpServerWebEvents,
  ],
  exports: [McpServerLibrary, RoleMcpServers, ProjectServerValues, SessionMcpServers],
})
export class McpServersModule {}
