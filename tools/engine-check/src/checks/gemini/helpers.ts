import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { CheckContext, Observation } from "../../check.ts";
import type { GeminiSession, GeminiSessionSpec, GeminiTurn } from "../../gemini/gemini-session.ts";
import type { OfficeTool } from "../../gemini/office-server.ts";
import { pinnedCliEntry } from "../../gemini/pinned-cli.ts";
import { geminiProcessEnvironment } from "../../gemini/session-environment.ts";
import { filesUnder } from "../observations.ts";

const execFileAsync = promisify(execFile);

/**
 * A shell command the model can run the same way through bash and PowerShell: Node, with a script in
 * single quotes only.
 */
export function nodeCommand(script: string): string {
  return `node -e "${script}"`;
}

/** A command that writes `file` in the session's folder after `delayMs`, so a check sees whether it ran to its end. */
export function writeFileLaterCommand(file: string, delayMs: number): string {
  return nodeCommand(`setTimeout(() => require('fs').writeFileSync('${file}', 'x'), ${delayMs})`);
}

/** A command that writes `file` in the session's folder at once. */
export function writeFileCommand(file: string): string {
  return nodeCommand(`require('fs').writeFileSync('${file}', 'x')`);
}

export function fileWritten(repository: string, file: string): boolean {
  return existsSync(join(repository, file));
}

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** How a turn ended, as a check records it: the stop reason and whether it errored. */
export function turnOutcome(turn: GeminiTurn): Observation {
  return { stopReason: turn.stopReason, failed: turn.error !== undefined };
}

/** The tool names the session's stream showed, each once, sorted. */
export function toolNames(session: GeminiSession): string[] {
  return sortedUnique(session.toolCalls.map((call) => call.name));
}

/** The tool names the hook saw, each once, sorted. */
export function hookSaw(session: GeminiSession): string[] {
  return sortedUnique(session.hookCalls.map((call) => call.input.tool_name));
}

/** The status of the session's first call of the tool, or `none`. */
export function callStatus(session: GeminiSession, toolName: string): string {
  return session.toolCalls.find((call) => call.name === toolName)?.status ?? "none";
}

export function sortedUnique(names: Iterable<string>): string[] {
  return [...new Set(names)].toSorted();
}

/** The flags the pinned CLI's `--help` lists, sorted, run in a home of its own. */
export async function cliFlags(home: string): Promise<string[]> {
  const { stdout } = await execFileAsync(process.execPath, [pinnedCliEntry(), "--help"], {
    env: geminiProcessEnvironment({ home }),
  });
  return sortedUnique(stdout.match(/--[a-z][a-z-]+/g) ?? []);
}

/** Starts a session in a repository of its own. */
export async function startIn(
  context: CheckContext,
  spec: Omit<GeminiSessionSpec, "repository"> = {},
): Promise<{ session: GeminiSession; repository: string }> {
  const repository = await context.sandbox.createRepository(
    `repository-${randomUUID().slice(0, 8)}`,
  );
  const session = await context.startGeminiSession({ repository, ...spec });
  return { session, repository };
}

/** An Office tool that answers `text`, after `delayMs` when given. */
export function answeringTool(
  name: string,
  description: string,
  text: string,
  delayMs = 0,
): OfficeTool {
  return {
    name,
    description,
    inputSchema: { type: "object", properties: { summary: { type: "string" } } },
    run: async () => {
      await wait(delayMs);
      return { text };
    },
  };
}

/** Whether any file under `folder` holds `text`. */
export async function anyFileHolds(folder: string, text: string): Promise<boolean> {
  for (const file of await filesUnder(folder)) {
    const content = await readFile(file, "utf8").catch(() => "");
    if (content.includes(text)) return true;
  }
  return false;
}
