import type {
  ClaudeCodePSession,
  ClaudeCodePSessionSpec,
} from "./claude-code-p/claude-code-p-session.ts";
import type { CodexSession, CodexSessionSpec } from "./codex/codex-session.ts";
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
