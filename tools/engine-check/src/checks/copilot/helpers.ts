import type { SessionEvent } from "@microsoft/copilot-sdk";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  CopilotHookCall,
  CopilotSession,
  PreToolUseHookOutput,
} from "../../copilot-cli/copilot-session.ts";
import { eventsOfType, lastAnswer, toolStarts } from "../../copilot-cli/events.ts";
import { sortedNames } from "../observations.ts";

export async function writeRepositoryFile(
  repository: string,
  path: string,
  content: string,
): Promise<void> {
  const file = join(repository, path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content);
}

export function fileExists(repository: string, path: string): boolean {
  return existsSync(join(repository, path));
}

/** Whether a call's input names `text` anywhere, such as a file's name in its path or command. */
export function inputMentions(input: unknown, text: string): boolean {
  return JSON.stringify(input ?? null).includes(text);
}

/** A refusal as the Office rules give one, with the reason the model is told. */
export function refusal(reason: string): PreToolUseHookOutput {
  return { permissionDecision: "deny", permissionDecisionReason: reason };
}

/** Whether the turn's last answer holds `word`, whatever its case: a fact, not the model's text. */
export function answerHolds(events: readonly SessionEvent[], word: string): boolean {
  return lastAnswer(events).toLowerCase().includes(word.toLowerCase());
}

/** The `preToolUse` calls, apart from the post hooks. */
export function preToolUseCalls(hookCalls: readonly CopilotHookCall[]): CopilotHookCall[] {
  return hookCalls.filter((call) => call.event === "preToolUse");
}

/** Whether every tool the session ran was first seen by `preToolUse`, by its tool-call id, before it started. */
export function everyRunHooked(
  events: readonly SessionEvent[],
  hookCalls: readonly CopilotHookCall[],
): boolean {
  return events.every(
    (event, index) =>
      event.type !== "tool.execution_start" ||
      preToolUseCalls(hookCalls).some(
        (call) => call.toolCallId === event.data.toolCallId && call.eventIndex <= index,
      ),
  );
}

/** The runtime's shell tools: `bash` on Linux and macOS, `powershell` on Windows. */
const SHELL_TOOLS: ReadonlySet<string> = new Set(["bash", "powershell"]);

export function isShellTool(toolName: string): boolean {
  return SHELL_TOOLS.has(toolName);
}

/** The root agent's shell calls among `events`' tool starts, in order. */
export function shellStarts(events: readonly SessionEvent[]): ReturnType<typeof toolStarts> {
  return toolStarts(events).filter((start) => !start.subAgent && isShellTool(start.toolName));
}

/** The names of the tools the session holds now, sorted: what the model is offered. */
export async function offeredTools(session: CopilotSession): Promise<string[]> {
  const metadata = await session.sdk.rpc.tools.getCurrentMetadata();
  return sortedNames((metadata.tools ?? []).map((tool) => tool.name));
}

/** The completion of the tool call `toolCallId`, as JSON, for looking for a reason in it. */
export function completionOf(
  events: readonly SessionEvent[],
  toolCallId: string | undefined,
): string {
  const completion = eventsOfType(events, "tool.execution_complete").find(
    (event) => event.data.toolCallId === toolCallId,
  );
  return completion === undefined ? "" : JSON.stringify(completion.data);
}
