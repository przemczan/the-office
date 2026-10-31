import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { McpSdkServerConfig } from "@anthropic-ai/claude-agent-sdk";
import type { McpServerConfig } from "./session-mcp-servers.js";

/** What the binary reads from `--mcp-config`. */
export interface McpConfig {
  readonly mcpServers: Readonly<Record<string, McpServerConfig | McpSdkServerConfig>>;
}

/**
 * A session's MCP config, Server values and secrets among them, in a file only its owner may read,
 * since a command line is open to every process of the user, an Agent's own commands included (spec
 * §6, Secrets). It sits in the session's folder of the Office data directory, beside the skills
 * folder, not in it: the Office rules refuse it. Each start and resume writes its own file, so ending
 * a session never removes the one its resume has just written. Owner-only where the system has file
 * modes; on Windows it takes the data directory's access list.
 */
export class McpConfigFile {
  private constructor(readonly path: string) {}

  static async write(
    sessionsFolder: string,
    sessionId: string,
    config: McpConfig,
  ): Promise<McpConfigFile> {
    const folder = join(sessionsFolder, sessionId);
    await mkdir(folder, { recursive: true, mode: 0o700 });
    const path = join(folder, `mcp-config-${randomUUID()}.json`);
    await writeFile(path, JSON.stringify(config), { flag: "wx", mode: 0o600 });
    return new McpConfigFile(path);
  }

  async remove(): Promise<void> {
    await rm(this.path, { force: true });
  }
}
