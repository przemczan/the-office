import type { MCPServerConfig, SessionEvent as CopilotEvent } from "@microsoft/copilot-sdk";

export type { CopilotEvent };

/**
 * A tool call the runtime asks about in its `onPreToolUse` hook, before the call runs: its own
 * tools, MCP tools (`<server>-<tool>`) and Office tools alike (spec §5.4).
 */
export interface CopilotToolCall {
  readonly toolName: string;
  /** The call's id, which its `tool.execution_*` events name. */
  readonly toolCallId: string | undefined;
  readonly toolArgs: unknown;
  /** Set for a Sub-agent's own call. */
  readonly agentId: string | undefined;
}

/** What the hook answers: run the call, or refuse it with the words the model reads. */
export type CopilotToolDecision =
  { readonly allowed: true } | { readonly allowed: false; readonly reason: string };

/** An Office tool as the runtime is given it: answered in the service's process (`defineTool`). */
export interface CopilotOfficeTool {
  readonly name: string;
  readonly description: string;
  /** The JSON Schema of its arguments. */
  readonly parameters: Readonly<Record<string, unknown>>;
  /** Runs the call; answers the words the model reads, or throws in words. */
  answer(args: unknown, toolCallId: string): Promise<string>;
}

/**
 * Everything one runtime process needs for one session: the engine's folder as `COPILOT_HOME`,
 * signed in by the engine's token when one is kept, else by the folder's own sign-in, and the
 * Office's lean options (no config discovery, custom instructions, cross-session store,
 * telemetry, co-author trailer or built-in agents; skills only from the folders named).
 */
export interface CopilotSessionSpec {
  /** The session id, the port's on a start; the one to resume on a resume. */
  readonly sessionId: string;
  readonly resume: boolean;
  /** The engine's folder, `<office-data>/engines/<engine id>/`. */
  readonly home: string;
  /** Revealed only here, into the SDK's `github.token`; undefined for the folder's own sign-in. */
  readonly token: string | undefined;
  /** As `copilotEnvironment` gives it. */
  readonly environment: Readonly<Record<string, string>>;
  readonly workingDirectory: string;
  /** Undefined for Auto, which names no model. */
  readonly model: string | undefined;
  /** Appended to the runtime's system message. */
  readonly instructions: string;
  /** The skill folders the session loads; none turns skills off. */
  readonly skillDirectories: readonly string[];
  /**
   * Skills the runtime would load that the session doesn't have, by the names it lists them by:
   * its bundled ones, and the Project's that the session's allowlist leaves out.
   */
  readonly disabledSkills: readonly string[];
  /**
   * Every tool the session is offered, by the runtime's names: the built-ins the Office rules
   * judge, the Office tools and each MCP tool as `<server>-<tool>`. The SDK refuses a session in
   * `mode: "empty"` without them.
   */
  readonly availableTools: readonly string[];
  readonly officeTools: readonly CopilotOfficeTool[];
  /** The Role's MCP servers, by name, with their values. */
  readonly mcpServers: Readonly<Record<string, MCPServerConfig>>;
}

export interface CopilotSessionHandlers {
  /** Every event of the session, in order, from before `open` answers. */
  onEvent(event: CopilotEvent): void;
  /** Asked before each tool call runs; a refusal ends the call `denied` with the reason. */
  preToolUse(call: CopilotToolCall): Promise<CopilotToolDecision>;
  /**
   * Asked for each of the runtime's permission requests, by the call it is of: whether to approve
   * it once. None came beside the hook in the engine check (spec §5.4).
   */
  permissionRequested(toolCallId: string | undefined): boolean;
  /** The runtime process ended without `close`, in words saying how. */
  runtimeExited(words: string): void;
}

/** A skill the runtime lists for the session (`skills.list`). */
export interface CopilotListedSkill {
  readonly name: string;
  /** Its `SKILL.md` or folder, when it has one on disk. */
  readonly path: string | undefined;
  readonly enabled: boolean;
}

export type CopilotAttachment =
  | {
      readonly type: "blob";
      readonly data: string;
      readonly mimeType: string;
      readonly displayName: string;
    }
  | { readonly type: "file"; readonly path: string; readonly displayName: string };

/** One message to the runtime. */
export interface CopilotMessage {
  readonly prompt: string;
  readonly attachments: readonly CopilotAttachment[];
  /** `immediate` lands in the running turn before its next tool call; `enqueue` after the turn. */
  readonly mode: "immediate" | "enqueue";
  /** Holds the turn's answer to a JSON Schema; refused with `immediate`. */
  readonly responseSchema: Readonly<Record<string, unknown>> | undefined;
  /** The port message's id, which the runtime echoes as the `user.message` event's `clientTurnId`. */
  readonly clientTurnId: string;
}

/** One session on its own runtime process. */
export interface CopilotRuntimeSession {
  readonly sessionId: string;
  /** Sends a message without waiting for the turn. */
  send(message: CopilotMessage): Promise<void>;
  /** Ends the running turn and its running command (`abort()`). */
  abort(): Promise<void>;
  /** The skills the session has loaded, as the runtime lists them. */
  listSkills(): Promise<readonly CopilotListedSkill[]>;
  /**
   * Disconnects the session, kept on disk for a resume, and ends its runtime process with every
   * process it started.
   */
  close(): Promise<void>;
}

/**
 * Opens a session on a runtime process: the pinned SDK's in the service
 * (`sdkCopilotSessions`), a stand-in replaying recordings in the default test run.
 */
export type OpenCopilotSession = (
  spec: CopilotSessionSpec,
  handlers: CopilotSessionHandlers,
) => Promise<CopilotRuntimeSession>;
