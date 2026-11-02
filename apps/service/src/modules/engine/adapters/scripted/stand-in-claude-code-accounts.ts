import type { EngineAccount } from "../../domain/engine-account.js";
import type { EngineId } from "../../domain/engines.js";
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
  email: "stand-in@example.com",
  plan: "max",
};

/**
 * The Claude Code accounts on scripted engines, so a test never runs the binary nor opens the
 * user's browser: every engine is signed out until a Sign in on it takes a code.
 */
export class StandInClaudeCodeAccounts extends ClaudeCodeAccounts {
  private readonly signedIn = new Set<EngineId>();
  private readonly signIns = new Map<EngineId, () => void>();

  account(engineId: EngineId): Promise<EngineAccount> {
    return Promise.resolve(this.signedIn.has(engineId) ? STAND_IN_ACCOUNT : { signedIn: false });
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
    this.signedIn.add(engineId);
    end();
    return Promise.resolve();
  }
}
