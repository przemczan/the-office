import type { OnModuleDestroy } from "@nestjs/common";
import { KeyedLocks } from "../../../../platform/locks/keyed-locks.js";
import type { OfficeDataDirectory } from "../../../../platform/office-data/office-data-directory.js";
import { EngineAccountUnreadable, type EngineAccount } from "../../domain/engine-account.js";
import type { EngineId } from "../../domain/engines.js";
import {
  CopilotCliAccounts,
  CopilotCliLoginFailed,
  type CopilotCliSignIn,
} from "../../ports/copilot-cli-accounts.js";
import {
  engineIdsWithConfigFolders,
  preparedEngineConfigFolder,
  removeEngineConfigFolder,
} from "../engine-folders/engine-config-folder.js";
import type {
  CopilotDeviceLogin,
  CopilotSignInRuntime,
  OpenCopilotSignInRuntime,
} from "./copilot-sign-in-runtime.js";

/** How long reading the sign-in, starting a Sign in or signing out has to end. */
const RUNTIME_TIMEOUT_MS = 30_000;
/** How long a Sign in waits for the user before The Office ends it, as long as GitHub's code lasts. */
const SIGN_IN_TIMEOUT_MS = 15 * 60_000;

/**
 * The sign-ins of the Copilot CLI engines through the pinned SDK's runtime, one started on the
 * engine's folder for each read or change and stopped after: the runtime's sign-in status, GitHub's
 * device flow and Sign out. Each engine's sign-in changes in turn.
 */
export class CopilotSdkAccounts extends CopilotCliAccounts implements OnModuleDestroy {
  private readonly signIns = new Map<EngineId, RunningSignIn>();
  private readonly loginChanges = new KeyedLocks();

  constructor(
    private readonly openRuntime: OpenCopilotSignInRuntime,
    private readonly officeData: OfficeDataDirectory,
  ) {
    super();
  }

  async account(engineId: EngineId): Promise<EngineAccount> {
    try {
      const { signedIn, login } = await this.withRuntime(engineId, (runtime) => runtime.status());
      if (!signedIn) return { signedIn: false };
      return { signedIn, pastedToken: false, apiKey: false, email: login, plan: undefined };
    } catch (error) {
      throw new EngineAccountUnreadable(
        `The Copilot CLI gave no sign-in status: ${messageOf(error)}`,
      );
    }
  }

  async signIn(engineId: EngineId): Promise<CopilotCliSignIn> {
    const running = await this.loginChanges.run(engineId, async () => {
      await this.signIns.get(engineId)?.end();
      const started = await this.startSignIn(engineId);
      this.signIns.set(engineId, started);
      void started.ended.then(() => this.forget(engineId, started));
      return started;
    });
    return { url: running.url, userCode: running.userCode, ended: running.ended };
  }

  signOut(engineId: EngineId): Promise<void> {
    return this.loginChanges.run(engineId, async () => {
      await this.signIns.get(engineId)?.end();
      try {
        await this.withRuntime(engineId, async (runtime) => {
          if ((await runtime.status()).signedIn) await runtime.signOut();
        });
      } catch (error) {
        throw new CopilotCliLoginFailed(`The Copilot CLI didn't sign out: ${messageOf(error)}`);
      }
    });
  }

  async prepareHome(engineId: EngineId): Promise<void> {
    await preparedEngineConfigFolder(this.officeData, engineId);
  }

  removeHome(engineId: EngineId): Promise<void> {
    return this.loginChanges.run(engineId, async () => {
      await this.signIns.get(engineId)?.end();
      await removeEngineConfigFolder(this.officeData, engineId);
    });
  }

  engineIdsWithHomes(): Promise<readonly EngineId[]> {
    return engineIdsWithConfigFolders(this.officeData);
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([...this.signIns.values()].map((running) => running.end()));
  }

  /** Starts the runtime and its device flow, which keeps the runtime until the flow ends. */
  private async startSignIn(engineId: EngineId): Promise<RunningSignIn> {
    let runtime: CopilotSignInRuntime | undefined;
    try {
      runtime = await this.openOn(engineId);
      const login = await withinTimeout(runtime.beginDeviceLogin());
      return new RunningSignIn(runtime, login);
    } catch (error) {
      await runtime?.close();
      throw new CopilotCliLoginFailed(
        `The Copilot CLI didn't start a Sign in: ${messageOf(error)}`,
      );
    }
  }

  private async withRuntime<Result>(
    engineId: EngineId,
    work: (runtime: CopilotSignInRuntime) => Promise<Result>,
  ): Promise<Result> {
    const runtime = await this.openOn(engineId);
    try {
      return await withinTimeout(work(runtime));
    } finally {
      await runtime.close();
    }
  }

  private async openOn(engineId: EngineId): Promise<CopilotSignInRuntime> {
    const folder = await preparedEngineConfigFolder(this.officeData, engineId);
    return withinTimeout(this.openRuntime(folder));
  }

  /** Forgets an ended Sign in, unless another has taken its place. */
  private forget(engineId: EngineId, running: RunningSignIn): void {
    if (this.signIns.get(engineId) === running) this.signIns.delete(engineId);
  }
}

/**
 * A device flow under way with its runtime, ended by the user entering the code, by `end`, or
 * after `SIGN_IN_TIMEOUT_MS`; its runtime stopped however it ends.
 */
class RunningSignIn {
  readonly url: string;
  readonly userCode: string;
  readonly ended: Promise<void>;
  private readonly runtime: CopilotSignInRuntime;
  private readonly login: CopilotDeviceLogin;
  private readonly timer: NodeJS.Timeout;
  /** Set once The Office ends the flow, whose failure then tells nothing. */
  private endedOnPurpose = false;
  private stopped: Promise<void> | undefined;

  constructor(runtime: CopilotSignInRuntime, login: CopilotDeviceLogin) {
    this.runtime = runtime;
    this.login = login;
    this.url = login.url;
    this.userCode = login.userCode;
    this.timer = setTimeout(() => void this.end(), SIGN_IN_TIMEOUT_MS).unref();
    this.ended = login.finished
      .catch((error: unknown) => {
        if (this.endedOnPurpose) return;
        throw new CopilotCliLoginFailed(`The Copilot CLI didn't sign in: ${messageOf(error)}`);
      })
      .finally(() => this.stop());
  }

  /** Ends the flow unfinished and waits for its runtime to stop. */
  async end(): Promise<void> {
    if (!this.endedOnPurpose) {
      this.endedOnPurpose = true;
      await this.login.cancel().catch(() => undefined);
      // Stopping the runtime also ends a flow that the cancel left waiting.
      await this.stop();
    }
    await this.ended.catch(() => undefined);
  }

  private stop(): Promise<void> {
    clearTimeout(this.timer);
    this.stopped ??= this.runtime.close();
    return this.stopped;
  }
}

function withinTimeout<Result>(work: Promise<Result>): Promise<Result> {
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("it didn't answer in time.")), RUNTIME_TIMEOUT_MS);
  });
  return Promise.race([work, timedOut]).finally(() => clearTimeout(timer));
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
