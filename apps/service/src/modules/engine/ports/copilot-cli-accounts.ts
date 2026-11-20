import type { EngineAccount } from "../domain/engine-account.js";
import type { EngineId } from "../domain/engines.js";

/** A Sign in under way on a Copilot CLI engine: GitHub's device flow for its folder. */
export interface CopilotCliSignIn {
  /** GitHub's page where `userCode` is entered, from any browser. */
  readonly url: string;
  /** The one-time code the page asks for. */
  readonly userCode: string;
  /** Settles once the login ends: signed in, refused, timed out, or ended by another change. */
  readonly ended: Promise<void>;
}

/** The runtime refused to change the engine's sign-in, in words, which never hold a token. */
export class CopilotCliLoginFailed extends Error {}

/**
 * The sign-ins of the Copilot CLI engines kept in each engine's folder, the runtime's
 * `COPILOT_HOME` (spec §5.4): read from the runtime's sign-in status, made by GitHub's device flow,
 * removed by Sign out. A pasted token is no part of it: the database keeps that one. One Sign in
 * runs per engine at a time.
 */
export abstract class CopilotCliAccounts {
  /** The folder's sign-in, as the runtime's sign-in status tells it. */
  abstract account(engineId: EngineId): Promise<EngineAccount>;

  /** Starts GitHub's device flow on the engine's folder, ending any Sign in still under way there. */
  abstract signIn(engineId: EngineId): Promise<CopilotCliSignIn>;

  /** Removes the folder's sign-in, ending any Sign in under way there. */
  abstract signOut(engineId: EngineId): Promise<void>;

  /** Makes the engine's folder, where it signs in and keeps its sessions, when the engine is added. */
  abstract prepareHome(engineId: EngineId): Promise<void>;

  /**
   * Ends any Sign in under way on the engine and removes its folder, its sign-in and its sessions
   * with it, when the engine is removed.
   */
  abstract removeHome(engineId: EngineId): Promise<void>;

  /** The ids of the engines whose folder is there, listed or not. */
  abstract engineIdsWithHomes(): Promise<readonly EngineId[]>;
}
