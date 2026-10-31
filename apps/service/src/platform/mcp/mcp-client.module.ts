import { Module } from "@nestjs/common";
import { McpClient } from "./mcp-client.js";
import { SdkMcpClient } from "./sdk-mcp-client.js";

/** The MCP client, for a module that connects to MCP servers. */
@Module({
  providers: [{ provide: McpClient, useClass: SdkMcpClient }],
  exports: [McpClient],
})
export class McpClientModule {}
