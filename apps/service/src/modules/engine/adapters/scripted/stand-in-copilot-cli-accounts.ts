import type { EngineAccount } from "../../domain/engine-account.js";
import type { EngineId } from "../../domain/engines.js";
import { CopilotCliAccounts, type CopilotCliSignIn } from "../../ports/copilot-cli-accounts.js";

/** GitHub's device page a stand-in Sign in on a Copilot CLI engine gives. */
export const STAND_IN_COPILOT_CLI_SIGN_IN_PAGE = "https://github.com/login/device";

/** The one-time code a stand-in Sign in on a Copilot CLI engine gives. */
export const STAND_IN_COPILOT_CLI_USER_CODE = "C0PL-1NCD";

/** The GitHub account a stand-in Sign in on a Copilot CLI engine signs in. */
export const STAND_IN_COPILOT_CLI_ACCOUNT: EngineAccount = {
  signedIn: true,
  pastedToken: false,
  apiKey: false,
  email: "stand-in-octocat",
  plan: undefined,
};

/**
 * The Copilot CLI sign-ins on scripted engines, so a test never starts the runtime: every engine is
 * signed out until a Sign in on it is approved (`approve`, as the user would on GitHub's page).
 */
export class StandInCopilotCliAccounts extends CopilotCliAccounts {
  private readonly signedIn = new Map<EngineId, EngineAccount>();
  private readonly signIns = new Map<EngineId, () => void>();

  account(engineId: EngineId): Promise<EngineAccount> {
    return Promise.resolve(this.signedIn.get(engineId) ?? { signedIn: false });
  }

  signIn(engineId: EngineId): Promise<CopilotCliSignIn> {
    this.signIns.get(engineId)?.();
    const ended = new Promise<void>((resolve) => {
      this.signIns.set(engineId, () => {
        this.signIns.delete(engineId);
        resolve();
      });
    });
    return Promise.resolve({
      url: STAND_IN_COPILOT_CLI_SIGN_IN_PAGE,
      userCode: STAND_IN_COPILOT_CLI_USER_CODE,
      ended,
    });
  }

  /** The user enters the code on GitHub's page: the Sign in ends signed in. Whether one was under way. */
  approve(engineId: EngineId): boolean {
    const end = this.signIns.get(engineId);
    if (end === undefined) return false;
    this.signedIn.set(engineId, STAND_IN_COPILOT_CLI_ACCOUNT);
    end();
    return true;
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

  /** Its sign-in goes with it, as the folder would take it. */
  removeHome(engineId: EngineId): Promise<void> {
    this.signIns.get(engineId)?.();
    this.signedIn.delete(engineId);
    return Promise.resolve();
  }

  /** The engines signed in, as their folders would hold their sign-ins. */
  engineIdsWithHomes(): Promise<readonly EngineId[]> {
    return Promise.resolve([...this.signedIn.keys()]);
  }
}
