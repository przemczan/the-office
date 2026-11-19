import type { CodexApiKey } from "../domain/codex-api-key.js";
import type { EngineAccount } from "../domain/engine-account.js";
import type { EngineId } from "../domain/engines.js";

/** A Sign in under way on a Codex engine: the binary's `codex login --device-auth` for its folder. */
export interface CodexSignIn {
  /** The page that signs in from any browser once `userCode` is entered there. */
  readonly url: string;
  /** The one-time code the page asks for. */
  readonly userCode: string;
  /** Settles once the login ends: signed in, refused, timed out, or ended by another change. */
  readonly ended: Promise<void>;
}

/**
 * The binary refused to change the engine's login: an API key it didn't take, or a Sign out that
 * failed; in words, which never hold the key.
 */
export class CodexLoginFailed extends Error {}

/**
 * The accounts of the Codex engines, each in its engine's folder, the app-server's `CODEX_HOME`
 * (spec §5.4): read with the app-server's `account/read`, signed in with `codex login
 * --device-auth` or by an API key (`codex login --with-api-key`), signed out with `codex logout`.
 * One login runs per engine at a time.
 */
export abstract class CodexAccounts {
  /** What `account/read` says of the engine's folder. */
  abstract account(engineId: EngineId): Promise<EngineAccount>;

  /** Starts a Sign in with ChatGPT on the engine's folder, ending any still under way there. */
  abstract signIn(engineId: EngineId): Promise<CodexSignIn>;

  /**
   * Signs the engine's folder in with an OpenAI API key, in place of any ChatGPT login it held,
   * ending any Sign in under way there. The key reaches the binary on its input alone.
   */
  abstract setApiKey(engineId: EngineId, key: CodexApiKey): Promise<void>;

  /** Signs the engine's folder out, whatever signed it in, ending any Sign in under way there. */
  abstract signOut(engineId: EngineId): Promise<void>;

  /** Makes the engine's folder, where it signs in, when the engine is added. */
  abstract prepareHome(engineId: EngineId): Promise<void>;

  /**
   * Ends any Sign in under way on the engine and removes its folder, its account and its threads
   * with it, when the engine is removed.
   */
  abstract removeHome(engineId: EngineId): Promise<void>;

  /** The ids of the engines whose folder is there, listed or not. */
  abstract engineIdsWithHomes(): Promise<readonly EngineId[]>;
}
