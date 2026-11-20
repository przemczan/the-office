import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { CheckContext, Observation } from "../../check.ts";
import type { GeminiSession, GeminiTurn } from "../../gemini/gemini-session.ts";
import { GEMINI_TRANSPORTS, type GeminiTransport } from "../../gemini/options.ts";
import { pinnedCliEntry } from "../../gemini/pinned-cli.ts";
import { geminiProcessEnvironment } from "../../gemini/session-environment.ts";
import type { Json } from "../../json.ts";
import { filesUnder } from "../observations.ts";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Runs the same observation on both transports, so a check's entry compares them side by side. */
export async function onBothTransports(
  observe: (transport: GeminiTransport) => Promise<Observation>,
): Promise<Observation> {
  const observations: Record<string, Json> = {};
  for (const transport of GEMINI_TRANSPORTS) {
    observations[transport] = await observe(transport);
  }
  return observations;
}

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

export function fileWritten(repository: string, file: string): boolean {
  return existsSync(join(repository, file));
}

/** How a turn ended, as a check records it: the stop reason and whether it errored. */
export function turnOutcome(turn: GeminiTurn): Observation {
  return { stopReason: turn.stopReason, failed: turn.error !== undefined };
}

/** The tool names the session's output showed, each once, sorted. */
export function toolNames(session: GeminiSession): string[] {
  return sortedUnique(session.toolCalls.map((call) => call.name));
}

export function sortedUnique(names: Iterable<string>): string[] {
  return [...new Set(names)].toSorted();
}

/** The flags the pinned CLI's `--help` lists, sorted, run in a home of its own. */
export async function cliFlags(home: string): Promise<string[]> {
  const { stdout } = await execFileAsync(process.execPath, [pinnedCliEntry(), "--help"], {
    env: geminiProcessEnvironment(home),
  });
  return sortedUnique(stdout.match(/--[a-z][a-z-]+/g) ?? []);
}

/** Starts a session on each transport the check names, in a repository of its own. */
export async function startIn(
  context: CheckContext,
  transport: GeminiTransport,
  extra: Omit<Parameters<CheckContext["startGeminiSession"]>[0], "transport" | "repository"> = {},
): Promise<{ session: GeminiSession; repository: string }> {
  const repository = await context.sandbox.createRepository(
    `repository-${transport}-${randomUUID().slice(0, 8)}`,
  );
  const session = await context.startGeminiSession({ transport, repository, ...extra });
  return { session, repository };
}

/** Whether any file under `folder` holds `text`. */
export async function anyFileHolds(folder: string, text: string): Promise<boolean> {
  for (const file of await filesUnder(folder)) {
    const content = await readFile(file, "utf8").catch(() => "");
    if (content.includes(text)) {
      return true;
    }
  }
  return false;
}
