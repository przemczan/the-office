import type { CodexApiKey } from "../../domain/codex-api-key.js";
import { CODEX_API_KEY_ACCOUNT, type EngineAccount } from "../../domain/engine-account.js";
import type { EngineId } from "../../domain/engines.js";
import { CodexAccounts, type CodexSignIn } from "../../ports/codex-accounts.js";

/** The device page a stand-in Sign in on a Codex engine gives. */
export const STAND_IN_CODEX_SIGN_IN_PAGE = "https://auth.openai.com/codex/device";

/** The one-time code a stand-in Sign in on a Codex engine gives. */
export const STAND_IN_CODEX_USER_CODE = "STND-1NCODE";

/** The ChatGPT account a stand-in Sign in on a Codex engine signs in. */
export const STAND_IN_CODEX_ACCOUNT: EngineAccount = {
  signedIn: true,
  pastedToken: false,
  apiKey: false,
  email: "stand-in@example.com",
  plan: "plus",
};

/**
 * The Codex accounts on scripted engines, so a test never runs the binary's login: every engine is
 * signed out until a Sign in on it is approved (`approve`, as the user would on the device page) or
 * an API key is given, and the key is kept nowhere.
 */
export class StandInCodexAccounts extends CodexAccounts {
  private readonly signedIn = new Map<EngineId, EngineAccount>();
  private readonly signIns = new Map<EngineId, () => void>();

  account(engineId: EngineId): Promise<EngineAccount> {
    return Promise.resolve(this.signedIn.get(engineId) ?? { signedIn: false });
  }

  signIn(engineId: EngineId): Promise<CodexSignIn> {
    this.signIns.get(engineId)?.();
    const ended = new Promise<void>((resolve) => {
      this.signIns.set(engineId, () => {
        this.signIns.delete(engineId);
        resolve();
      });
    });
    return Promise.resolve({
      url: STAND_IN_CODEX_SIGN_IN_PAGE,
      userCode: STAND_IN_CODEX_USER_CODE,
      ended,
    });
  }

  /**
   * The user approves the Sign in under way on the device page: it ends signed in with ChatGPT.
   * Whether one was under way.
   */
  approve(engineId: EngineId): boolean {
    const end = this.signIns.get(engineId);
    if (end === undefined) return false;
    this.signedIn.set(engineId, STAND_IN_CODEX_ACCOUNT);
    end();
    return true;
  }

  setApiKey(engineId: EngineId, _key: CodexApiKey): Promise<void> {
    this.signIns.get(engineId)?.();
    this.signedIn.set(engineId, CODEX_API_KEY_ACCOUNT);
    return Promise.resolve();
  }

  signOut(engineId: EngineId): Promise<void> {
    this.signIns.get(engineId)?.();
    this.signedIn.delete(engineId);
    return Promise.resolve();
  }

  /** A stand-in keeps no folder. */
  prepareHome(_engineId: EngineId): Promise<void> {
    return Promise.resolve();
  }

  /** Its account goes with it, as the folder would take it. */
  removeHome(engineId: EngineId): Promise<void> {
    this.signIns.get(engineId)?.();
    this.signedIn.delete(engineId);
    return Promise.resolve();
  }

  /** The engines signed in, as their folders would hold their logins. */
  engineIdsWithHomes(): Promise<readonly EngineId[]> {
    return Promise.resolve([...this.signedIn.keys()]);
  }
}
