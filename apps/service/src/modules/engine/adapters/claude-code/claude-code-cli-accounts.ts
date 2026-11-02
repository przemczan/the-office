import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { OnModuleDestroy } from "@nestjs/common";
import type { OfficeDataDirectory } from "../../../../platform/office-data/office-data-directory.js";
import type { ProcessTrees } from "../../../../platform/os/process-trees.js";
import {
  engineAccountOf,
  EngineAccountUnreadable,
  type EngineAccount,
} from "../../domain/engine-account.js";
import type { EngineId } from "../../domain/engines.js";
import {
  ClaudeCodeAccounts,
  SignInFailed,
  SignInNotRunning,
  type SignIn,
} from "../../ports/claude-code-accounts.js";
import { preparedEngineConfigFolder } from "./engine-config-folder.js";
import { sessionEnvironment } from "./session-settings.js";

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
 * a code pasted on its input, which is how a browser on another machine signs in.
 */
export class ClaudeCodeCliAccounts extends ClaudeCodeAccounts implements OnModuleDestroy {
  private readonly signIns = new Map<EngineId, RunningSignIn>();

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

  async account(engineId: EngineId): Promise<EngineAccount> {
    const env = await this.environmentOf(engineId);
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
    return engineAccountOf(output);
  }

  async signIn(engineId: EngineId): Promise<SignIn> {
    await this.signIns.get(engineId)?.end();
    const { command, args } = this.cli();
    const child = spawn(command, [...args, "auth", "login", "--claudeai"], {
      env: await this.environmentOf(engineId),
      stdio: "pipe",
      detached: this.processTrees.detached,
      windowsHide: true,
    });
    const running = new RunningSignIn(child, this.processTrees);
    this.signIns.set(engineId, running);
    void running.ended.then(() => this.forget(engineId, running));
    try {
      return { url: await running.page, ended: running.ended };
    } catch (error) {
      await running.end();
      throw error;
    }
  }

  enterCode(engineId: EngineId, code: string): Promise<void> {
    const running = this.signIns.get(engineId);
    if (running === undefined) return Promise.reject(new SignInNotRunning(engineId));
    running.enter(code);
    return Promise.resolve();
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([...this.signIns.values()].map((running) => running.end()));
  }

  /** Forgets an ended login, unless another Sign in has taken its place. */
  private forget(engineId: EngineId, running: RunningSignIn): boolean {
    return this.signIns.get(engineId) === running && this.signIns.delete(engineId);
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
    this.ended = new Promise((resolve) => {
      child.once("close", () => resolve());
      child.once("error", () => resolve());
    });
    this.page = this.pageOf(child);
    // A rejected page is awaited by the Sign in; this only keeps a late rejection quiet.
    this.page.catch(() => undefined);
    const giveUp = setTimeout(() => void this.end(), SIGN_IN_TIMEOUT_MS);
    giveUp.unref();
    void this.ended.then(() => clearTimeout(giveUp));
  }

  enter(code: string): void {
    this.child.stdin.write(`${code.trim()}\n`);
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
