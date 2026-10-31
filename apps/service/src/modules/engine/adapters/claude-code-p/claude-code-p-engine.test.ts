import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe } from "vitest";
import { OfficeDataDirectory } from "../../../../platform/office-data/office-data-directory.js";
import { describeAgentEngineContract } from "../../ports/agent-engine.contract.js";
import { serveSessionEndpoints, type ServedEndpoints } from "../http/session-endpoints.fixtures.js";
import { CONTRACT_MCP_SERVER } from "../mcp-servers/contract-mcp-server.fixtures.js";
import { CLAUDE_CODE_P_CAPABILITIES, ClaudeCodePEngine } from "./claude-code-p-engine.js";

/**
 * These tests run real sessions on the user's login, which cost quota, so they run only when asked:
 * OFFICE_ENGINE_TESTS=live (apps/service/docs/testing.md). The session endpoints are served as the
 * service serves them, with no database.
 */
const MODE = process.env["OFFICE_ENGINE_TESTS"];
const MODEL = "claude-haiku-5-5";

/** No session here works inside it; the Office rules keep sessions out of it. */
const OFFICE_DATA = new OfficeDataDirectory(join(tmpdir(), "office-engine-data"));

describe.runIf(MODE === "live")("ClaudeCodePEngine on a live session", () => {
  let served: ServedEndpoints;

  beforeAll(async () => {
    served = await serveSessionEndpoints();
  });

  afterAll(async () => {
    await served.app.close();
  });

  const liveEngine = () => new ClaudeCodePEngine(OFFICE_DATA, served.endpoints);

  describeAgentEngineContract("ClaudeCodePEngine", {
    capabilities: CLAUDE_CODE_P_CAPABILITIES,
    model: MODEL,
    timeoutMs: 180_000,
    mcpServer: CONTRACT_MCP_SERVER,
    engineFor: () => Promise.resolve(liveEngine()),
  });
});
