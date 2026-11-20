import type {
  ClaudeCodePSession,
  ClaudeCodePSessionSpec,
} from "./claude-code-p/claude-code-p-session.ts";
import type { CodexSession, CodexSessionSpec } from "./codex/codex-session.ts";
import type { CopilotSession } from "./copilot-cli/copilot-session.ts";
import type { CopilotSessionSpec } from "./copilot-cli/session-options.ts";
import type { GeminiSession, GeminiSessionSpec } from "./gemini/gemini-session.ts";
import type { Json } from "./json.ts";
import type { ProbeSession, SessionSpec } from "./probe-session.ts";
import type { Sandbox } from "./sandbox.ts";

export type Platform = "win32" | "linux";

/** What a check saw, as facts that hold run to run: booleans and sorted names, never model text or token counts. */
export type Observation = { [fact: string]: Json };

/**
 * Thrown by a check that can't observe what it is for on this account now, such as a refused turn
 * while no usage window is used up; the run reports it skipped with the reason, and records nothing.
 */
export class CheckSkipped extends Error {}

export interface CheckContext {
  readonly sandbox: Sandbox;
  /** Aborted when the check times out. */
  readonly signal: AbortSignal;
  /**
   * A second signed-in Claude Code config folder, which a check runs sessions in with
   * `CLAUDE_CONFIG_DIR`, beside the account the other checks run on; undefined when the run was
   * given none.
   */
  readonly secondClaudeConfig: string | undefined;
  /** Starts a session the runner closes, counts tokens for and deletes after the check. */
  startSession(spec: SessionSpec): Promise<ProbeSession>;
  /** The same for a session on the pinned binary in `-p`, the fallback's route (spec §5.4 Defaults). */
  startClaudeCodePSession(spec: ClaudeCodePSessionSpec): Promise<ClaudeCodePSession>;
  /**
   * The same for a session on the pinned `codex app-server`, the Codex engine (spec §5.4 Defaults),
   * whose threads the runner deletes after the check. Throws `CheckSkipped` when the run was given no
   * Codex folder or the folder is not signed in.
   */
  startCodexSession(spec: CodexSessionSpec): Promise<CodexSession>;
  /**
   * The Copilot runtime's config folder (`COPILOT_HOME`) the check's Copilot sessions share, inside
   * the sandbox, so a resume finds the session and the user's own `~/.copilot` is never used.
   */
  readonly copilotHome: string;
  /**
   * The same for a session on the pinned Copilot runtime through its SDK. Throws `CheckSkipped` when
   * the run was given no Copilot token.
   */
  startCopilotSession(spec: CopilotSessionSpec): Promise<CopilotSession>;
  /**
   * The same for a session on the pinned Gemini CLI, over ACP or headless as the spec says, in a home
   * of its own, signed in as the spec's `signIn` says: with the run's Gemini API key (the default), or
   * with the credentials of the folder `--gemini-sign-in` signed in. Throws `CheckSkipped` when the run
   * has no key, or that folder is not signed in.
   */
  startGeminiSession(spec: GeminiSessionSpec): Promise<GeminiSession>;
}

export interface Check {
  /** Stable id shared by the expectations file and engine-check.md, as `<area>.<name>`. */
  readonly id: string;
  readonly title: string;
  /** Platforms the check runs on; both when omitted. */
  readonly platforms?: readonly Platform[];
  readonly timeoutMs?: number;
  /** Runs for a long time on purpose, so it runs only when asked for with `--include-slow`. */
  readonly slow?: boolean;
  run(context: CheckContext): Promise<Observation>;
}
