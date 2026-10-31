import { fakeStdioMcpServer } from "../../../../platform/mcp/fake-mcp-servers.fixtures.js";
import { isRunning } from "../../../../platform/os/process-trees.fixtures.js";
import type { ContractMcpServer } from "../../ports/agent-engine.contract.js";

/** The platform's fake local MCP server, for the contract's `mcp-tool` scenario. */
export const CONTRACT_MCP_SERVER: ContractMcpServer = {
  launch: (variables, folder) => ({ ...fakeStdioMcpServer([], variables), workingFolder: folder }),
  isRunning,
};
