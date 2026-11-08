import { join } from "node:path";
import { tmpdir } from "node:os";
import type { CommandJudgement, OfficeToolCall } from "./office-tool.js";

/**
 * An Office tool's call from the session `sessionId`, for a test that runs a tool directly: its
 * output folder is a temporary one of the session's, and every command line is allowed unless
 * `judgeCommand` says otherwise.
 */
export function anOfficeToolCall(
  sessionId: string,
  judgeCommand: (commandLine: string) => CommandJudgement = () => ({ allowed: true }),
): OfficeToolCall {
  return {
    sessionId,
    outputFolder: join(tmpdir(), "office-tool-tests", sessionId),
    judgeCommand: (commandLine) => Promise.resolve(judgeCommand(commandLine)),
  };
}
