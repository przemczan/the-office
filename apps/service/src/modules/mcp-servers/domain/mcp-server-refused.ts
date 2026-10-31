/** An MCP server change that breaks the library's rules, with every reason, in the UI's words. */
export class McpServerRefused extends Error {
  constructor(readonly reasons: readonly string[]) {
    super(reasons.join(" "));
    this.name = "McpServerRefused";
  }
}
