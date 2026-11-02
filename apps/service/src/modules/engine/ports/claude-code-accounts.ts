import type { EngineAccount } from "../domain/engine-account.js";
import type { EngineId } from "../domain/engines.js";
import type { PastedToken } from "../domain/pasted-token.js";

/** A Sign in under way: the binary's `claude auth login` for one engine's folder. */
export interface SignIn {
  /**
   * The page that signs in by a code to paste back (`enterCode`), for when no browser opened or
   * The Office runs on another machine than the browser.
   */
  readonly url: string;
  /** Settles once the login ends: signed in, refused, timed out, or ended by another Sign in. */
  readonly ended: Promise<void>;
}

/** There is no Sign in under way on the engine to take a code. */
export class SignInNotRunning extends Error {
  constructor(readonly engineId: EngineId) {
    super("No Sign in is under way on this engine; start one again.");
  }
}

/** The login gave no sign-in page: it didn't start, or ended first; in words. */
export class SignInFailed extends Error {}

/**
 * The accounts of the Claude Code engines, each in its engine's config folder (spec §5.4): read
 * with `claude auth status`, signed in with `claude auth login` or by a pasted token.
 */
export abstract class ClaudeCodeAccounts {
  /** What `auth status` says of the engine's folder. */
  abstract account(engineId: EngineId): Promise<EngineAccount>;

  /** Starts a Sign in on the engine's folder, ending any still under way there. */
  abstract signIn(engineId: EngineId): Promise<SignIn>;

  /** Hands the Sign in under way the code the sign-in page gave; `SignInNotRunning` without one. */
  abstract enterCode(engineId: EngineId, code: string): Promise<void>;

  /**
   * Signs the engine in by a token the user pasted ("Paste a token instead"), in place of any login
   * its folder held, ending any Sign in under way there so it can't sign in over the token.
   */
  abstract setPastedToken(engineId: EngineId, token: PastedToken): Promise<void>;

  /**
   * Signs the engine out, whether a Sign in or a pasted token signed it in, ending any Sign in under
   * way there.
   */
  abstract signOut(engineId: EngineId): Promise<void>;

  /** Makes the engine's config folder, where it signs in, when the engine is added. */
  abstract prepareConfigFolder(engineId: EngineId): Promise<void>;

  /**
   * Ends any Sign in under way on the engine and removes its config folder, its account and its
   * sessions' transcripts with it, when the engine is removed.
   */
  abstract removeConfigFolder(engineId: EngineId): Promise<void>;
}
