import { CopilotClient, RuntimeConnection, type CopilotSession } from "@microsoft/copilot-sdk";
import { copilotEnvironment } from "./copilot-environment.js";

/** The folder's sign-in as the runtime tells it. */
export interface CopilotSignInStatus {
  readonly signedIn: boolean;
  /** The GitHub login, when told. */
  readonly login?: string;
}

/** GitHub's device flow under way in a runtime. */
export interface CopilotDeviceLogin {
  /** GitHub's page where the code is entered. */
  readonly url: string;
  readonly userCode: string;
  /** Settles once the user has entered the code and the folder is signed in; rejects in words. */
  readonly finished: Promise<void>;
  /** Ends the flow unfinished. */
  cancel(): Promise<void>;
}

/**
 * A Copilot CLI runtime started on one engine's folder for its sign-in alone: no session of an
 * Agent runs on it. Closed by whoever opened it.
 */
export interface CopilotSignInRuntime {
  status(): Promise<CopilotSignInStatus>;
  beginDeviceLogin(): Promise<CopilotDeviceLogin>;
  /** Removes the folder's sign-in. */
  signOut(): Promise<void>;
  close(): Promise<void>;
}

/** Starts a runtime on the folder `home`: the pinned SDK's in the service, a stand-in in tests. */
export type OpenCopilotSignInRuntime = (home: string) => Promise<CopilotSignInRuntime>;

/** How long the runtime has to stop before it is killed. */
const STOP_TIMEOUT_MS = 5000;

/**
 * Runtimes of the pinned `@microsoft/copilot-sdk`, each its own process over stdio with
 * `COPILOT_HOME` the engine's folder and the environment `copilotEnvironment` gives. It reads the
 * folder's own sign-in (`useLoggedInUser`) and nothing else: the client's `empty` mode keeps the
 * system keychain out, and no GitHub variable reaches it.
 *
 * The device flow is the SDK's typed `accounts.login` (begin, then one `advance` that polls until
 * the user has entered the code), which lives on a session: the runtime starts one with no tools
 * for it. The engine check hasn't observed it yet (docs/engine-check.md, open on the Copilot CLI):
 * a plaintext-consent step, which a folder without a keychain may ask, is answered yes, so the
 * sign-in is kept in the folder.
 */
export function sdkSignInRuntimes(
  environment: Readonly<Record<string, string>>,
): OpenCopilotSignInRuntime {
  return async (home) => {
    const client = new CopilotClient({
      mode: "empty",
      runtime: RuntimeConnection.forSpawnedStdio({
        env: copilotEnvironment(environment),
        baseDirectory: home,
      }),
      github: { useLoggedInUser: true },
      observability: { logLevel: "warning" },
    });
    try {
      await client.start();
    } catch (error) {
      await stopped(client);
      throw error;
    }
    return new SdkSignInRuntime(client, home);
  };
}

class SdkSignInRuntime implements CopilotSignInRuntime {
  private session: CopilotSession | undefined;

  constructor(
    private readonly client: CopilotClient,
    private readonly home: string,
  ) {}

  async status(): Promise<CopilotSignInStatus> {
    const { isAuthenticated, login } = await this.client.getAuthStatus();
    return login === undefined
      ? { signedIn: isAuthenticated }
      : { signedIn: isAuthenticated, login };
  }

  async beginDeviceLogin(): Promise<CopilotDeviceLogin> {
    const session = await this.loginSession();
    const login = session.rpc.accounts.login;
    const { flowId, step } = await login.begin({ kind: "githubDotCom", method: "device-code" });
    if (step.kind !== "device-code") {
      await login.cancel({ flowId }).catch(() => undefined);
      throw new Error(`the runtime gave no one-time code (${stepWords(step)}).`);
    }
    return {
      url: step.verificationUri,
      userCode: step.userCode,
      finished: finishLogin((input) =>
        login.advance(input === undefined ? { flowId } : { flowId, input }),
      ),
      cancel: () => login.cancel({ flowId }),
    };
  }

  async signOut(): Promise<void> {
    await this.client.rpc.account.logout({});
  }

  async close(): Promise<void> {
    await this.session?.disconnect().catch(() => undefined);
    await stopped(this.client);
  }

  private async loginSession(): Promise<CopilotSession> {
    this.session ??= await this.client.createSession({
      clientName: "the-office",
      workingDirectory: this.home,
      enableConfigDiscovery: false,
      tools: { availableTools: [] },
    });
    return this.session;
  }
}

type LoginStep = Awaited<ReturnType<CopilotSession["rpc"]["accounts"]["login"]["advance"]>>;

/** Advances the flow until it ends: signed in, or refused in words. */
async function finishLogin(advance: (input?: string) => Promise<LoginStep>): Promise<void> {
  let step = await advance();
  for (;;) {
    if (step.kind === "error") throw new Error(step.message);
    if (step.kind !== "completed") throw new Error(`the sign-in stopped at ${stepWords(step)}.`);
    const { status } = step.result;
    if (status === "completed") return;
    if (status !== "needs-plaintext-consent") {
      throw new Error(`the sign-in ended ${status}.`);
    }
    step = await advance("yes");
  }
}

function stepWords(step: LoginStep): string {
  return step.kind === "error" ? step.message : `the step ${step.kind}`;
}

async function stopped(client: CopilotClient): Promise<void> {
  const stop = await Promise.race([
    client.stop().then(
      () => true,
      () => false,
    ),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), STOP_TIMEOUT_MS).unref()),
  ]);
  if (!stop) await client.forceStop().catch(() => undefined);
}
