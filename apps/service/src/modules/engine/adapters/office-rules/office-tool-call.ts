import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { PathRules } from "../../../../platform/os/path-rules.js";
import type { ToolDecision } from "../../domain/office-rules.js";
import type { OfficeToolCall } from "../../ports/office-tool.js";

/** Whether the session may make a call, by the tool's name as the engine names it. */
export type ToolDecider = (tool: string, input: unknown) => Promise<ToolDecision>;

/**
 * The service's temporary folder of one session, which its Office rules let it read (spec §6):
 * the API engine's background commands' output, and the files the Office tools write for it.
 * Each adapter removes it as the session ends.
 */
export function sessionTemporaryFolder(paths: PathRules, sessionId: string): string {
  return paths.join(tmpdir(), "office-sessions", sessionId);
}

/** Removes the session's temporary folder; one Windows still holds a little longer is no harm. */
export async function removeSessionTemporaryFolder(
  paths: PathRules,
  sessionId: string,
): Promise<void> {
  await rm(sessionTemporaryFolder(paths, sessionId), {
    recursive: true,
    force: true,
    maxRetries: 5,
  }).catch(() => undefined);
}

/**
 * What an Office tool is told of the session calling it: a command line is judged as the session's
 * own Bash call would be, by `decide`, the same rules and holds the engine's hook decides by. Bash
 * is the shell Agents have on every platform (spec §5.4), so a profile's rules always reach it.
 */
export function officeToolCall(
  sessionId: string,
  paths: PathRules,
  decide: ToolDecider,
): OfficeToolCall {
  return {
    sessionId,
    outputFolder: paths.join(sessionTemporaryFolder(paths, sessionId), "office-tools"),
    judgeCommand: async (commandLine) => {
      const decision = await decide("Bash", { command: commandLine });
      return decision.allowed ? { allowed: true } : { allowed: false, reason: decision.reason };
    },
  };
}
