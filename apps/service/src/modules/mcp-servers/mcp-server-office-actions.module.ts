import { Module } from "@nestjs/common";
import { EngineModule } from "../engine/index.js";
import { McpServerOfficeActionsController } from "./adapters/http/mcp-server-office-actions.controller.js";
import { McpServerOfficeActions } from "./adapters/office-actions/mcp-server-office-actions.js";
import { McpServersModule } from "./mcp-servers.module.js";

/**
 * The library's Office actions: their routes, and their tools on the Engine's registry. Apart from
 * `McpServersModule` so the modules that read the library (Conversations, People) don't take the
 * Engine in with it.
 */
@Module({
  imports: [McpServersModule, EngineModule],
  controllers: [McpServerOfficeActionsController],
  providers: [McpServerOfficeActions],
})
export class McpServerOfficeActionsModule {}
