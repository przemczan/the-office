import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { Logger, type OnModuleDestroy } from "@nestjs/common";
import { KeyedLocks } from "../../../../platform/locks/keyed-locks.js";
import type { OfficeDataDirectory } from "../../../../platform/office-data/office-data-directory.js";
import type { ProcessTrees } from "../../../../platform/os/process-trees.js";
import type { AnthropicApiKey } from "../../domain/anthropic-api-key.js";
import {
  API_KEY_ACCOUNT,
  engineAccountOf,
  EngineAccountUnreadable,
  type EngineAccount,
} from "../../domain/engine-account.js";
import type { EngineId } from "../../domain/engines.js";
import type { PastedToken } from "../../domain/pasted-token.js";
import {
  ClaudeCodeAccounts,
  SignInFailed,
  SignInNotRunning,
  type SignIn,
} from "../../ports/claude-code-accounts.js";
import {
  ownEngineConfigFolder,
  preparedEngineConfigFolder,
  engineIdsWithConfigFolders,
  removeEngineConfigFolder,
} from "../engine-folders/engine-config-folder.js";
import {
  apiKeyFileOf,
  holdsLogin,
  holdsPastedToken,
  removeApiKey,
  removeEngineCredentials,
  writeApiKey,
  writePastedToken,
} from "./engine-credentials.js";
import { sessionEnvironment } from "./session-settings.js";

const logger = new Logger("ClaudeCodeCliAccounts");

/** How the Claude Code binary is run: the pinned one in the service, a stand-in in tests. */
export interface ClaudeCodeCli {
  readonly command: string;
  /** Given before the binary's own arguments, such as a script a stand-in runs. */
  readonly args: readonly string[];
}

const STATUS_TIMEOUT_MS = 30_000;
/** How long the login has to print its sign-in page. */
const SIGN_IN_PAGE_TIMEOUT_MS = 30_000;
/** How long a Sign in waits for the user before The Office ends it. */
const SIGN_IN_TIMEOUT_MS = 15 * 60_000;
/** How much of the login's output is kept: its page, or its last words when it ends early. */
const OUTPUT_KEPT = 4000;
/** The line the login prints with the page that signs in by a pasted code. */
const SIGN_IN_PAGE = /visit:\s*(https:\/\/\S+)/;

/**
 * The accounts of the Claude Code engines through the binary's `auth` commands, each run with
 * `CLAUDE_CONFIG_DIR` on the engine's folder. With no TTY the login opens the browser where there is
 * a display (`BROWSER` names another opener), waits for its callback on `localhost`, and also takes
 * a code pasted on its input, which is how a browser on another machine signs in. A pasted token,
 * an API key and Sign out change the folder's login files directly, as the binary has no command
 * for them. Logins are exclusive: each change removes what signed the folder in before.
 */
export class ClaudeCodeCliAccounts extends ClaudeCodeAccounts implements OnModuleDestroy {
  private readonly signIns = new Map<EngineId, RunningSignIn>();
  /** Each engine's login changes in turn, so no Sign in starts unseen by the next change. */
  private readonly loginChanges = new KeyedLocks();

  constructor(
    /** Found at each command, so a service without the binary still starts. */
    private readonly cli: () => ClaudeCodeCli,
    private readonly officeData: OfficeDataDirectory,
    private readonly processTrees: ProcessTrees,
    /** The service's environment, which the binary's own variables are dropped from. */
    private readonly environment: Readonly<Record<string, string>>,
  ) {
    super();
  }

  /**
   * An API key signs the folder in while it holds one: `auth status` runs without the session
   * settings, whose `apiKeyHelper` reads it, so it would say signed out.
   */
  async account(engineId: EngineId): Promise<EngineAccount> {
    const folder = await preparedEngineConfigFolder(this.officeData, engineId);
    if ((await apiKeyFileOf(folder)) !== undefined) return API_KEY_ACCOUNT;
    const env = sessionEnvironment(this.environment, folder);
    const { command, args } = this.cli();
    const output = await new Promise<string>((resolve, reject) => {
      execFile(
        command,
        [...args, "auth", "status", "--json"],
        { env, timeout: STATUS_TIMEOUT_MS, windowsHide: true },
        // Signed out exits 1 and still prints its status.
        (error, stdout) => {
          if (stdout.trim() === "" && error !== null) {
            reject(
              new EngineAccountUnreadable(`Claude Code gave no account status: ${error.message}`),
            );
          } else resolve(stdout);
        },
      );
    });
    return engineAccountOf(output, await holdsPastedToken(folder));
  }

  async signedInByApiKey(engineId: EngineId): Promise<boolean> {
    return (await apiKeyFileOf(ownEngineConfigFolder(this.officeData, engineId))) !== undefined;
  }

  async signIn(engineId: EngineId): Promise<SignIn> {
    const running = await this.loginChanges.run(engineId, async () => {
      await this.signIns.get(engineId)?.end();
      const { command, args } = this.cli();
      const child = spawn(command, [...args, "auth", "login", "--claudeai"], {
        env: await this.environmentOf(engineId),
        stdio: "pipe",
        detached: this.processTrees.detached,
        windowsHide: true,
      });
      const started = new RunningSignIn(child, this.processTrees);
      this.signIns.set(engineId, started);
      return started;
    });
    const ended = running.ended.then(() => this.afterSignIn(engineId, running));
    try {
      return { url: await running.page, ended };
    } catch (error) {
      await running.end();
      // Nobody waits for a Sign in that never gave its page; its clean-up only tidies the folder.
      void ended.catch(() => undefined);
      throw error;
    }
  }

  enterCode(engineId: EngineId, code: string): Promise<void> {
    const running = this.signIns.get(engineId);
    if (running?.enter(code) !== true) return Promise.reject(new SignInNotRunning(engineId));
    return Promise.resolve();
  }

  setPastedToken(engineId: EngineId, token: PastedToken): Promise<void> {
    return this.loginChanges.run(engineId, async () => {
      await this.signIns.get(engineId)?.end();
      const folder = ownEngineConfigFolder(this.officeData, engineId);
      await preparedEngineConfigFolder(this.officeData, engineId);
      await writePastedToken(folder, token, new Date());
    });
  }

  setApiKey(engineId: EngineId, key: AnthropicApiKey): Promise<void> {
    return this.loginChanges.run(engineId, async () => {
      await this.signIns.get(engineId)?.end();
      const folder = ownEngineConfigFolder(this.officeData, engineId);
      await preparedEngineConfigFolder(this.officeData, engineId);
      await writeApiKey(folder, key);
    });
  }

  signOut(engineId: EngineId): Promise<void> {
    return this.loginChanges.run(engineId, async () => {
      await this.signIns.get(engineId)?.end();
      await removeEngineCredentials(ownEngineConfigFolder(this.officeData, engineId));
    });
  }

  async prepareConfigFolder(engineId: EngineId): Promise<void> {
    await preparedEngineConfigFolder(this.officeData, engineId);
  }

  removeConfigFolder(engineId: EngineId): Promise<void> {
    return this.loginChanges.run(engineId, async () => {
      await this.signIns.get(engineId)?.end();
      await removeEngineConfigFolder(this.officeData, engineId);
    });
  }

  engineIdsWithConfigFolders(): Promise<readonly EngineId[]> {
    return engineIdsWithConfigFolders(this.officeData);
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([...this.signIns.values()].map((running) => running.end()));
  }

  /**
   * Forgets an ended login, unless another Sign in has taken its place, and removes any API key once
   * it signed the folder in. A login ended by a pasted token, an API key or Sign out is ended under
   * the lock before that change, so this runs after it and finds the change's files.
   */
  private afterSignIn(engineId: EngineId, running: RunningSignIn): Promise<void> {
    return this.loginChanges.run(engineId, async () => {
      if (this.signIns.get(engineId) !== running) return;
      this.signIns.delete(engineId);
      const folder = ownEngineConfigFolder(this.officeData, engineId);
      if (await holdsLogin(folder)) await removeApiKey(folder);
    });
  }

  private async environmentOf(engineId: EngineId): Promise<Record<string, string>> {
    const folder = await preparedEngineConfigFolder(this.officeData, engineId);
    return sessionEnvironment(this.environment, folder);
  }
}

/** One engine's login, ended by its own end, by The Office after a while, or by another Sign in. */
class RunningSignIn {
  /** The page that signs in by a pasted code, once the login prints it. */
  readonly page: Promise<string>;
  readonly ended: Promise<void>;
  private output = "";

  constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly processTrees: ProcessTrees,
  ) {
    const giveUp = setTimeout(() => {
      void this.end().catch((error: unknown) => {
        logger.warn("The Claude Code Sign in that ran too long didn't end.", error);
      });
    }, SIGN_IN_TIMEOUT_MS);
    giveUp.unref();
    this.ended = new Promise((resolve) => {
      const ended = (): void => {
        clearTimeout(giveUp);
        resolve();
      };
      child.once("close", ended);
      child.once("error", ended);
    });
    this.page = this.pageOf(child);
    // A code pasted while the login exits meets a closing pipe; `enter` says so instead.
    child.stdin.on("error", () => undefined);
    // A rejected page is awaited by the Sign in; this only keeps a late rejection quiet.
    this.page.catch(() => undefined);
  }

  /** Whether the login could still take the code. */
  enter(code: string): boolean {
    if (!this.child.stdin.writable) return false;
    this.child.stdin.write(`${code.trim()}\n`);
    return true;
  }

  async end(): Promise<void> {
    const { pid, exitCode, signalCode } = this.child;
    if (pid !== undefined && exitCode === null && signalCode === null) {
      await this.processTrees.end(pid);
    }
    await this.ended;
  }

  private pageOf(child: ChildProcessWithoutNullStreams): Promise<string> {
    return new Promise((resolve, reject) => {
      const waited = setTimeout(
        () => reject(new SignInFailed("Claude Code gave no sign-in page.")),
        SIGN_IN_PAGE_TIMEOUT_MS,
      );
      const read = (chunk: string): void => {
        this.output = (this.output + chunk).slice(-OUTPUT_KEPT);
        const page = SIGN_IN_PAGE.exec(this.output)?.[1];
        if (page === undefined) return;
        clearTimeout(waited);
        resolve(page);
      };
      for (const stream of [child.stdout, child.stderr]) {
        stream.setEncoding("utf8");
        stream.on("data", read);
      }
      child.once("error", (error) => {
        clearTimeout(waited);
        reject(new SignInFailed(`Claude Code didn't start: ${error.message}`));
      });
      // Once the page is given, this rejection is ignored.
      child.once("close", () => {
        clearTimeout(waited);
        reject(new SignInFailed(`Claude Code ended the Sign in: ${lastWords(this.output)}`));
      });
    });
  }
}

function lastWords(output: string): string {
  const lines = output.split(/\r?\n/).filter((line) => line.trim() !== "");
  return lines.at(-1)?.trim() ?? "it said nothing.";
}
