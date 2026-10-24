import type { Json } from "./json.ts";
import type { ProbeSession, SessionSpec } from "./probe-session.ts";
import type { Sandbox } from "./sandbox.ts";

export type Platform = "win32" | "linux";

/** What a check saw, as facts that hold run to run: booleans and sorted names, never model text or token counts. */
export type Observation = { [fact: string]: Json };

export interface CheckContext {
  readonly sandbox: Sandbox;
  /** Aborted when the check times out. */
  readonly signal: AbortSignal;
  /** Starts a session the runner closes, counts tokens for and deletes after the check. */
  startSession(spec: SessionSpec): Promise<ProbeSession>;
}

export interface Check {
  /** Stable id shared by the expectations file and engine-check.md, as `<area>.<name>`. */
  readonly id: string;
  readonly title: string;
  /** Platforms the check runs on; both when omitted. */
  readonly platforms?: readonly Platform[];
  readonly timeoutMs?: number;
  run(context: CheckContext): Promise<Observation>;
}
