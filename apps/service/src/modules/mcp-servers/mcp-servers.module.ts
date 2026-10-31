import { Module } from "@nestjs/common";
import { McpServersController } from "./adapters/http/mcp-servers.controller.js";
import { PostgresMcpServerRepository } from "./adapters/postgres/postgres-mcp-server-repository.js";
import { McpServerWebEvents } from "./adapters/websocket/mcp-server-web-events.js";
import { McpServerLibrary } from "./application/mcp-server-library.js";
import { McpServerRepository } from "./ports/mcp-server-repository.js";

@Module({
  controllers: [McpServersController],
  providers: [
    { provide: McpServerRepository, useClass: PostgresMcpServerRepository },
    McpServerLibrary,
    McpServerWebEvents,
  ],
  exports: [McpServerLibrary],
})
export class McpServersModule {}
