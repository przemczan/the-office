import type { SDKControlGetContextUsageResponse } from "@anthropic-ai/claude-agent-sdk";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  FAKE_STDIO_MCP_SERVER,
  fakeStdioMcpServer,
} from "../../../../platform/mcp/fake-mcp-servers.fixtures.js";
import { OfficeDataDirectory } from "../../../../platform/office-data/office-data-directory.js";
import { currentOperatingSystem } from "../../../../platform/os/current-operating-system.js";
import { describeAgentEngineContract } from "../../ports/agent-engine.contract.js";
import type { SessionOptions } from "../../ports/session-options.js";
import { EngineProcess } from "../claude-code/engine-process.js";
import { McpConfigFile } from "../claude-code/mcp-config-file.js";
import { FIRST_CLAUDE_CODE_ENGINE } from "../../domain/engines.js";
import { preparedEngineConfigFolder } from "../claude-code/engine-config-folder.js";
import { sessionEnvironment } from "../claude-code/session-settings.js";
import { serveSessionEndpoints, type ServedEndpoints } from "../http/session-endpoints.fixtures.js";
import { CONTRACT_MCP_SERVER } from "../mcp-servers/contract-mcp-server.fixtures.js";
import {
  claudeCodePArguments,
  claudeCodePMcpConfig,
  TOKEN_VARIABLE,
} from "./claude-code-p-arguments.js";
import { CLAUDE_CODE_P_CAPABILITIES, ClaudeCodePEngine } from "./claude-code-p-engine.js";
import { OfficeToolServer } from "./office-tool-server.js";
import { pinnedBinaryPath } from "./pinned-binary.js";
import { StreamJson } from "./stream-json.js";

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
    engine: FIRST_CLAUDE_CODE_ENGINE,
    model: MODEL,
    timeoutMs: 180_000,
    mcpServer: CONTRACT_MCP_SERVER,
    engineFor: () => Promise.resolve(liveEngine()),
  });

  // No model call: the session is never sent a message.
  it("runs the session's MCP servers from their file beside the Office tools, and never a Project's own, even one its settings turn on", async () => {
    const operatingSystem = currentOperatingSystem();
    const folder = await mkdtemp(join(tmpdir(), "office-mcp-"));
    const projectServer = { command: process.execPath, args: [FAKE_STDIO_MCP_SERVER] };
    await writeFile(
      join(folder, ".mcp.json"),
      JSON.stringify({ mcpServers: { "project-server": projectServer } }),
    );
    await mkdir(join(folder, ".claude"));
    await writeFile(
      join(folder, ".claude", "settings.json"),
      JSON.stringify({ enableAllProjectMcpServers: true }),
    );
    const id = randomUUID();
    const options: SessionOptions = {
      folder,
      environment: sessionEnvironment(
        Object.fromEntries(
          Object.entries(process.env).filter(
            (entry): entry is [string, string] => entry[1] !== undefined,
          ),
        ),
        await preparedEngineConfigFolder(OFFICE_DATA, FIRST_CLAUDE_CODE_ENGINE.id),
      ),
      engine: FIRST_CLAUDE_CODE_ENGINE,
      model: MODEL,
      effort: "low",
      skills: undefined,
      profile: { edit: false, run: { kind: "read-only-git" }, web: false, mcpTools: {} },
      officeTools: [
        {
          name: "note",
          description: "Notes a word.",
          input: z.object({ word: z.string() }),
          run: () => Promise.resolve({ text: "Noted.", isError: false }),
        },
      ],
      mcpServers: [{ name: "fake", launch: fakeStdioMcpServer(), tools: [] }],
      instructions: "",
      outputSchema: undefined,
    };
    const mcpConfig = claudeCodePMcpConfig(options);
    if (mcpConfig === undefined) throw new Error("The session has MCP servers.");
    const mcpConfigFile = await McpConfigFile.write(OFFICE_DATA.folder("sessions"), id, mcpConfig);
    const officeTools = new OfficeToolServer(options.officeTools, id, () =>
      Promise.resolve({ allowed: true }),
    );
    const engineProcess = new EngineProcess(operatingSystem.processTrees);
    const engine = engineProcess.spawn({
      command: pinnedBinaryPath(operatingSystem.claudeCodeBinaries),
      args: claudeCodePArguments({
        id,
        resumes: false,
        options,
        agentShells: [],
        hookUrl: "http://127.0.0.1:9/hook",
        instructionsFile: undefined,
        mcpConfigFile: mcpConfigFile.path,
      }),
      cwd: folder,
      env: { ...options.environment, [TOKEN_VARIABLE]: "token" },
    });
    const stream = new StreamJson(engine, [officeTools]);
    try {
      // The servers connect without blocking the session's start.
      await expect
        .poll(
          async () => {
            const { mcpTools } =
              await stream.request<SDKControlGetContextUsageResponse>("get_context_usage");
            return [...new Set(mcpTools.map(({ serverName }) => serverName))].toSorted();
          },
          { timeout: 30_000, interval: 500 },
        )
        .toEqual(["fake", "office"]);
    } finally {
      stream.endInput();
      await engineProcess.endWithLeftovers();
      await officeTools.close();
      await mcpConfigFile.remove();
      await rm(folder, { recursive: true, force: true });
    }
  }, 60_000);
});
