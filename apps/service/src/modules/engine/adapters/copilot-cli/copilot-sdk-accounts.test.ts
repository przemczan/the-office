import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OfficeDataDirectory } from "../../../../platform/office-data/office-data-directory.js";
import { EngineAccountUnreadable } from "../../domain/engine-account.js";
import { CopilotCliLoginFailed } from "../../ports/copilot-cli-accounts.js";
import { engineConfigFolder } from "../engine-folders/engine-config-folder.js";
import { CopilotSdkAccounts } from "./copilot-sdk-accounts.js";
import type {
  CopilotDeviceLogin,
  CopilotSignInRuntime,
  CopilotSignInStatus,
} from "./copilot-sign-in-runtime.js";

const DEVICE_PAGE = "https://github.com/login/device";

/**
 * A runtime standing in for the SDK's, keeping each folder's sign-in in memory: a device flow ends
 * signed in once the test enters its code (`enterCode`), as the user would on GitHub's page.
 */
class StandInRuntimes {
  readonly signedIn = new Map<string, string>();
  readonly opened: string[] = [];
  open = 0;
  failStatus: Error | undefined;
  private readonly flows = new Map<string, () => void>();

  readonly openRuntime = (home: string): Promise<CopilotSignInRuntime> => {
    this.opened.push(home);
    this.open += 1;
    return Promise.resolve(this.runtimeOn(home));
  };

  enterCode(home: string): void {
    this.flows.get(home)?.();
  }

  private runtimeOn(home: string): CopilotSignInRuntime {
    return {
      status: (): Promise<CopilotSignInStatus> => {
        if (this.failStatus !== undefined) return Promise.reject(this.failStatus);
        const login = this.signedIn.get(home);
        return Promise.resolve(
          login === undefined ? { signedIn: false } : { signedIn: true, login },
        );
      },
      beginDeviceLogin: (): Promise<CopilotDeviceLogin> => {
        let cancel: (() => void) | undefined;
        const finished = new Promise<void>((resolve, reject) => {
          cancel = () => reject(new Error("cancelled"));
          this.flows.set(home, () => {
            this.signedIn.set(home, "octocat");
            resolve();
          });
        });
        // A cancelled flow's rejection is the adapter's to take.
        finished.catch(() => undefined);
        return Promise.resolve({
          url: DEVICE_PAGE,
          userCode: "ABCD-1234",
          finished,
          cancel: () => {
            cancel?.();
            return Promise.resolve();
          },
        });
      },
      signOut: () => {
        this.signedIn.delete(home);
        return Promise.resolve();
      },
      close: () => {
        this.open -= 1;
        return Promise.resolve();
      },
    };
  }
}

let officeData: OfficeDataDirectory;
let runtimes: StandInRuntimes;
let accounts: CopilotSdkAccounts;

beforeEach(async () => {
  officeData = new OfficeDataDirectory(await mkdtemp(join(tmpdir(), "office-copilot-accounts-")));
  runtimes = new StandInRuntimes();
  accounts = new CopilotSdkAccounts(runtimes.openRuntime, officeData);
});

afterEach(async () => {
  await accounts.onModuleDestroy();
  await rm(officeData.path, { recursive: true, force: true });
});

describe("CopilotSdkAccounts", () => {
  it("runs the runtime on the engine's own folder, and stops it after reading the sign-in", async () => {
    await expect(accounts.account("copilot")).resolves.toEqual({ signedIn: false });

    const folder = engineConfigFolder(officeData, "copilot");
    expect(runtimes.opened).toEqual([folder]);
    expect((await stat(folder)).isDirectory()).toBe(true);
    expect(runtimes.open).toBe(0);
  });

  it("signs in by GitHub's device page and code, then reads the GitHub login", async () => {
    const signIn = await accounts.signIn("copilot");

    expect(signIn).toMatchObject({ url: DEVICE_PAGE, userCode: "ABCD-1234" });
    runtimes.enterCode(engineConfigFolder(officeData, "copilot"));
    await signIn.ended;

    await expect(accounts.account("copilot")).resolves.toEqual({
      signedIn: true,
      pastedToken: false,
      apiKey: false,
      email: "octocat",
      plan: undefined,
    });
    expect(runtimes.open).toBe(0);
  });

  it("ends a Sign in under way when another starts, or on Sign out", async () => {
    const first = await accounts.signIn("copilot");
    const second = await accounts.signIn("copilot");
    await first.ended;

    await accounts.signOut("copilot");
    await second.ended;

    await expect(accounts.account("copilot")).resolves.toEqual({ signedIn: false });
    expect(runtimes.open).toBe(0);
  });

  it("signs a signed-in folder out", async () => {
    runtimes.signedIn.set(engineConfigFolder(officeData, "copilot"), "octocat");

    await accounts.signOut("copilot");

    await expect(accounts.account("copilot")).resolves.toEqual({ signedIn: false });
  });

  it("tells in words when the runtime gives no sign-in status", async () => {
    runtimes.failStatus = new Error("the runtime exited");

    await expect(accounts.account("copilot")).rejects.toThrow(EngineAccountUnreadable);
    await expect(accounts.account("copilot")).rejects.toThrow(/the runtime exited/);
    await expect(accounts.signOut("copilot")).rejects.toThrow(CopilotCliLoginFailed);
    expect(runtimes.open).toBe(0);
  });

  it("removes the engine's folder, ending its Sign in, and lists the folders there", async () => {
    await accounts.prepareHome("copilot");
    await accounts.prepareHome("other");
    const signIn = await accounts.signIn("copilot");

    await accounts.removeHome("copilot");
    await signIn.ended;

    expect(await accounts.engineIdsWithHomes()).toEqual(["other"]);
    expect(runtimes.open).toBe(0);
  });
});
