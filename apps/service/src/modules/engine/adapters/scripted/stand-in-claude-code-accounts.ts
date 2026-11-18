import type { AnthropicApiKey } from "../../domain/anthropic-api-key.js";
import { API_KEY_ACCOUNT, type EngineAccount } from "../../domain/engine-account.js";
import type { EngineId } from "../../domain/engines.js";
import type { PastedToken } from "../../domain/pasted-token.js";
import {
  ClaudeCodeAccounts,
  SignInNotRunning,
  type SignIn,
} from "../../ports/claude-code-accounts.js";

/** The page a stand-in Sign in gives. */
export const STAND_IN_SIGN_IN_PAGE = "https://claude.com/cai/oauth/authorize?stand-in=true";

/** The account a stand-in Sign in signs in. */
export const STAND_IN_ACCOUNT: EngineAccount = {
  signedIn: true,
  pastedToken: false,
  apiKey: false,
  email: "stand-in@example.com",
  plan: "max",
};

/** The account a pasted token signs in on a stand-in. */
export const STAND_IN_PASTED_TOKEN_ACCOUNT: EngineAccount = {
  signedIn: true,
  pastedToken: true,
  apiKey: false,
  email: undefined,
  plan: undefined,
};

/**
 * The Claude Code accounts on scripted engines, so a test never runs the binary nor opens the
 * user's browser: every engine is signed out until a Sign in on it takes a code, a token is pasted
 * or an API key given, and the token or key is kept nowhere.
 */
export class StandInClaudeCodeAccounts extends ClaudeCodeAccounts {
  private readonly signedIn = new Map<EngineId, EngineAccount>();
  private readonly signIns = new Map<EngineId, () => void>();

  account(engineId: EngineId): Promise<EngineAccount> {
    return Promise.resolve(this.signedIn.get(engineId) ?? { signedIn: false });
  }

  signedInByApiKey(engineId: EngineId): Promise<boolean> {
    const account = this.signedIn.get(engineId);
    return Promise.resolve(account?.signedIn === true && account.apiKey);
  }

  signIn(engineId: EngineId): Promise<SignIn> {
    this.signIns.get(engineId)?.();
    const ended = new Promise<void>((resolve) => {
      this.signIns.set(engineId, () => {
        this.signIns.delete(engineId);
        resolve();
      });
    });
    return Promise.resolve({ url: STAND_IN_SIGN_IN_PAGE, ended });
  }

  enterCode(engineId: EngineId, _code: string): Promise<void> {
    const end = this.signIns.get(engineId);
    if (end === undefined) return Promise.reject(new SignInNotRunning(engineId));
    this.signedIn.set(engineId, STAND_IN_ACCOUNT);
    end();
    return Promise.resolve();
  }

  setPastedToken(engineId: EngineId, _token: PastedToken): Promise<void> {
    this.signIns.get(engineId)?.();
    this.signedIn.set(engineId, STAND_IN_PASTED_TOKEN_ACCOUNT);
    return Promise.resolve();
  }

  setApiKey(engineId: EngineId, _key: AnthropicApiKey): Promise<void> {
    this.signIns.get(engineId)?.();
    this.signedIn.set(engineId, API_KEY_ACCOUNT);
    return Promise.resolve();
  }

  signOut(engineId: EngineId): Promise<void> {
    this.signIns.get(engineId)?.();
    this.signedIn.delete(engineId);
    return Promise.resolve();
  }

  /** A stand-in keeps no folder. */
  prepareConfigFolder(_engineId: EngineId): Promise<void> {
    return Promise.resolve();
  }

  /** Its account goes with it, as the folder would take it. */
  removeConfigFolder(engineId: EngineId): Promise<void> {
    this.signIns.get(engineId)?.();
    this.signedIn.delete(engineId);
    return Promise.resolve();
  }

  /** The engines signed in, as their folders would hold their logins. */
  engineIdsWithConfigFolders(): Promise<readonly EngineId[]> {
    return Promise.resolve([...this.signedIn.keys()]);
  }
}
