import type { Engine } from "../domain/engines.js";
import type { LanguageServer } from "../domain/language-servers.js";
import type { ApprovalSetting, PermissionProfile } from "../domain/permission-profile.js";
import type { OfficeTool } from "./office-tool.js";

/** How hard the model thinks, as a Role card names it. */
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/** A session's skills, as the Skills module prepared them (spec §5.6). */
export interface SessionSkills {
  /** The session's own plugin folder outside the worktree, which the file tools may read. */
  readonly folder: string;
  /** The engine's allowlist: the names the engine matches skills by. */
  readonly names: readonly string[];
  /** What the session must list at its start, no more and no less, by the names it lists them by. */
  readonly expected: readonly string[];
  /** The engine's per-skill listing overrides: each Project skill turned off. */
  readonly overrides: Readonly<Record<string, "off">>;
}

/**
 * An MCP server the session runs (spec §5.4), as the MCP servers module prepared it: how to reach
 * it with its values, which may hold secrets, and the tools it was given, named in the session
 * `mcp__<name>__<tool>`. The same on each resume, but for its values.
 */
export interface SessionMcpServer {
  readonly name: string;
  readonly launch: SessionMcpServerLaunch;
  readonly tools: readonly SessionMcpServerTool[];
}

/**
 * How to reach the server: the platform's `McpServerLaunch`, which the adapters hand to its
 * `McpClient`, restated because the ports layer takes nothing else from the platform.
 */
export type SessionMcpServerLaunch =
  | {
      readonly transport: "stdio";
      readonly command: string;
      readonly arguments: readonly string[];
      readonly environmentVariables: Readonly<Record<string, string>>;
      readonly workingFolder: string;
    }
  | {
      readonly transport: "streamable-http";
      readonly url: string;
      readonly headers: Readonly<Record<string, string>>;
    };

/** A tool as the server listed it at its review: the platform's `McpTool`. */
export interface SessionMcpServerTool {
  readonly name: string;
  readonly description: string;
  /** The JSON Schema of its input. */
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

/**
 * Asked before each tool call of a session, after the engine's input validation: the words that
 * refuse it while The Office holds every tool call, such as while the fire alarm is on (spec
 * §2.8), or undefined to judge the call by the Office rules.
 */
export type ToolHold = () => Promise<string | undefined>;

/** A call of an MCP tool whose setting asks for someone's approval: Consult a person or Ask me. */
export interface ApprovalCall {
  readonly server: string;
  readonly tool: string;
  /** As the Agent gave it; the same input makes the same call, which an approval lets run once. */
  readonly input: unknown;
  readonly setting: ApprovalSetting;
}

/**
 * Asked for each call that waits on approval (spec §6), as a held Hard switch's call is: undefined
 * when an approval lets it run now, else the words that refuse it, such as that it waits on a
 * Decision. Apart from `ToolHold`, so a hold of every call never approves one.
 */
export type ApprovalHold = (call: ApprovalCall) => Promise<string | undefined>;

/** A JSON Schema document, as an engine takes it for a turn's output. */
export type JsonSchema = Readonly<Record<string, unknown>>;

/**
 * What a session runs with. A resumed session is given the same options as when it started:
 * a changed model, effort or set of Office tools breaks its cached prefix (spec §5.4).
 */
export interface SessionOptions {
  /** The folder the session works in, such as a Task's worktree. */
  readonly folder: string;
  /**
   * The variables the session and its commands run with, such as a Project's command environment
   * (spec §5.5). The engine may drop those that would change how it runs itself.
   */
  readonly environment: Readonly<Record<string, string>>;
  /**
   * The engine Settings › Engines lists that the session runs on, as it was when the session
   * opened: its account's folder, or its API endpoint.
   */
  readonly engine: Engine;
  /** One of the engine's models, by its id there. */
  readonly model: string;
  readonly effort: Effort;
  /**
   * The Agent's standing instructions, such as its Role card's, added to the engine's system
   * prompt. The same for every session of a card version, so they stay in the cached prefix.
   */
  readonly instructions: string;
  /** Undefined for a session with no skill at all, not even the Project's. */
  readonly skills: SessionSkills | undefined;
  readonly profile: PermissionProfile;
  /**
   * Whether the session reaches the whole workstation, refused only the secrets: a Caretaker
   * Thread with changes allowed, working in the home folder (spec §6). Undefined for every other.
   */
  readonly workstation?: boolean;
  /**
   * What the Agent can do about a call its folders or profile refuse, which the refusal adds,
   * such as asking the user to Allow changes; undefined when there is nothing to add.
   */
  readonly refusalAdvice?: string;
  readonly officeTools: readonly OfficeTool[];
  /** The Role's MCP servers that run in the session; none when it has none. */
  readonly mcpServers: readonly SessionMcpServer[];
  /**
   * The workstation's language servers the session's LSP tool runs, the same for every Role and
   * fixed for the session; none on an engine without the `languageServers` capability.
   */
  readonly languageServers: readonly LanguageServer[];
  /** What each turn's output must match, or undefined for a reply in plain words. */
  readonly outputSchema: JsonSchema | undefined;
  /** Undefined for a session whose tool calls The Office never holds as a whole. */
  readonly toolHold?: ToolHold;
  /** Undefined for a session where a call waiting on approval is refused. */
  readonly approvalHold?: ApprovalHold;
}
