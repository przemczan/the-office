export class McpServerNotFound extends Error {
  constructor(readonly serverName: string) {
    super(`The library has no MCP server "${serverName}".`);
    this.name = "McpServerNotFound";
  }
}
