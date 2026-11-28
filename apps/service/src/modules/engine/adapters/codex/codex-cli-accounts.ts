import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { Logger, type OnModuleDestroy } from "@nestjs/common";
import { KeyedLocks } from "../../../../platform/locks/keyed-locks.js";
import type { OfficeDataDirectory } from "../../../../platform/office-data/office-data-directory.js";
import type { ProcessTrees } from "../../../../platform/os/process-trees.js";
import type { CodexApiKey } from "../../domain/codex-api-key.js";
import {
  codexEngineAccountOf,
  EngineAccountUnreadable,
  type EngineAccount,
} from "../../domain/engine-account.js";
import type { EngineId } from "../../domain/engines.js";
import { SignInFailed } from "../../ports/claude-code-accounts.js";
import { CodexAccounts, CodexLoginFailed, type CodexSignIn } from "../../ports/codex-accounts.js";
import {
  engineIdsWithConfigFolders,
  preparedEngineConfigFolder,
  removeEngineConfigFolder,
} from "../engine-folders/engine-config-folder.js";
import { codexAppServerArguments, codexEnvironment } from "./codex-arguments.js";
import { CodexAppServer, CodexRpcError, METHOD_NOT_FOUND } from "./codex-rpc.js";

const logger = new Logger("CodexCliAccounts");

/** How the Codex binary is run: the pinned one in the service, a stand-in script in tests. */
export interface CodexCli {
  readonly command: string;
  /** Given before the binary's own arguments, such as a script a stand-in runs. */
  readonly args: readonly string[];
}

/** How long reading the account, an API key's login or a Sign out has to end. */
const COMMAND_TIMEOUT_MS = 30_000;
/** How long the login has to print its page and code. */
const SIGN_IN_PAGE_TIMEOUT_MS = 30_000;
/** How long a Sign in waits for the user before The Office ends it, as long as its code lasts. */
const SIGN_IN_TIMEOUT_MS = 15 * 60_000;
/** How much of a command's output is kept: its page and code, or its last words. */
const OUTPUT_KEPT = 4000;
/** How the app-server is told who its client is. */
const CLIENT_INFO = { name: "the_office", title: "The Office", version: "1" } as const;

/** A terminal's colour and cursor codes, which the login prints its page and code in. */
// oxlint-disable-next-line no-control-regex -- the escape character is what it matches
const TERMINAL_CODES = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*\u0007/g;
/** The first page the login prints, the device page. */
const SIGN_IN_PAGE = /https:\/\/\S+/;
/**
 * The one-time code, on the first line with text after the line that names it (the 0.169.0
 * binary: "2. Enter this one-time code (expires in 15 minutes)", then the code, indented); only
 * once that line has ended, so a code cut across two reads is not taken short.
 */
const USER_CODE = /one-time code[^\n]*\n(?:[ \t]*\n)*[ \t]*([A-Za-z0-9][A-Za-z0-9-]{3,})[ \t]*\n/;
/** A code as OpenAI's device page gives one, should the line naming it change. */
const DASHED_CODE = /\b([A-Z0-9]{4,}-[A-Z0-9]{4,})\s/;
/** What `codex logout` says of a folder it found signed out already. */
const NOT_LOGGED_IN = /not logged in/i;

/**
 * The accounts of the Codex engines through the pinned binary, each command run with `CODEX_HOME`
 * on the engine's folder and none of the user's own Codex or OpenAI variables: the app-server
 * answers `account/read`, `login --device-auth` signs in with ChatGPT from any browser by a page
 * and a one-time code, `login --with-api-key` takes the key on its input and `logout` signs out.
 * The key never goes on a command line, in the environment or in a log.
 */
export class CodexCliAccounts extends CodexAccounts implements OnModuleDestroy {
  private readonly signIns = new Map<EngineId, RunningDeviceLogin>();
  /** Each engine's login changes in turn, so no Sign in starts unseen by the next change. */
  private readonly loginChanges = new KeyedLocks();

  constructor(
    /** Found at each command, so a service without the binary still starts. */
    private readonly cli: () => CodexCli,
    private readonly officeData: OfficeDataDirectory,
    private readonly processTrees: ProcessTrees,
    /** The service's environment, which Codex's and OpenAI's own variables are dropped from. */
    private readonly environment: Readonly<Record<string, string>>,
  ) {
    super();
  }

  async account(engineId: EngineId): Promise<EngineAccount> {
    const folder = await preparedEngineConfigFolder(this.officeData, engineId);
    const { command, args } = this.cliOrUnreadable();
    const server = CodexAppServer.start(
      this.processTrees,
      {
        command,
        args: [...args, ...codexAppServerArguments()],
        cwd: folder,
        env: codexEnvironment(this.environment, folder),
      },
      {
        notification: () => undefined,
        serverRequest: ({ method }) =>
          Promise.reject(
            new CodexRpcError(METHOD_NOT_FOUND, `The Office doesn't answer ${method}.`),
          ),
      },
    );
    let timer: NodeJS.Timeout | undefined;
    try {
      const read = (async () => {
        await server.rpc.request("initialize", {
          clientInfo: CLIENT_INFO,
          capabilities: { experimentalApi: true, requestAttestation: false },
        });
        server.rpc.notify("initialized");
        return server.rpc.request("account/read", { refreshToken: false });
      })();
      const timedOut = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("it didn't answer in time.")),
          COMMAND_TIMEOUT_MS,
        );
      });
      const { account } = await Promise.race([read, timedOut]);
      return codexEngineAccountOf(account);
    } catch (error) {
      throw new EngineAccountUnreadable(`Codex gave no account status: ${messageOf(error)}`);
    } finally {
      clearTimeout(timer);
      await server.kill();
    }
  }

  async signIn(engineId: EngineId): Promise<CodexSignIn> {
    const running = await this.loginChanges.run(engineId, async () => {
      await this.signIns.get(engineId)?.end();
      const child = await this.spawnCodex(engineId, ["login", "--device-auth"]);
      const started = new RunningDeviceLogin(child, this.processTrees);
      this.signIns.set(engineId, started);
      // oxlint-disable-next-line office/caught-voided-calls -- a login's end never rejects
      void started.ended.then(() => this.forget(engineId, started));
      return started;
    });
    try {
      const { url, userCode } = await running.page;
      return { url, userCode, ended: running.ended };
    } catch (error) {
      await running.end();
      throw error;
    }
  }

  setApiKey(engineId: EngineId, key: CodexApiKey): Promise<void> {
    return this.loginChanges.run(engineId, async () => {
      await this.signIns.get(engineId)?.end();
      const { code, output } = await this.runToEnd(
        engineId,
        ["login", "--with-api-key"],
        `${key.reveal()}\n`,
      );
      if (code !== 0) {
        // Codex never prints the key; it is struck out all the same, should it ever.
        const words = lastWords(output.split(key.reveal()).join(String(key)));
        throw new CodexLoginFailed(`Codex didn't take the API key: ${words}`);
      }
    });
  }

  signOut(engineId: EngineId): Promise<void> {
    return this.loginChanges.run(engineId, async () => {
      await this.signIns.get(engineId)?.end();
      const { code, output } = await this.runToEnd(engineId, ["logout"], undefined);
      if (code !== 0 && !NOT_LOGGED_IN.test(output)) {
        throw new CodexLoginFailed(`Codex didn't sign out: ${lastWords(output)}`);
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

  /** Forgets an ended login, unless another Sign in has taken its place. */
  private forget(engineId: EngineId, running: RunningDeviceLogin): boolean {
    return this.signIns.get(engineId) === running && this.signIns.delete(engineId);
  }

  private cliOrUnreadable(): CodexCli {
    try {
      return this.cli();
    } catch (error) {
      throw new EngineAccountUnreadable(`Codex gave no account status: ${messageOf(error)}`);
    }
  }

  private async spawnCodex(
    engineId: EngineId,
    codexArgs: readonly string[],
  ): Promise<ChildProcessWithoutNullStreams> {
    const folder = await preparedEngineConfigFolder(this.officeData, engineId);
    let cli: CodexCli;
    try {
      cli = this.cli();
    } catch (error) {
      throw new CodexLoginFailed(`Codex didn't start: ${messageOf(error)}`);
    }
    const { command, args } = cli;
    return spawn(command, [...args, ...codexArgs], {
      cwd: folder,
      env: codexEnvironment(this.environment, folder),
      stdio: "pipe",
      detached: this.processTrees.detached,
      windowsHide: true,
    });
  }

  /**
   * Runs one of the binary's commands to its end, `input` written on its input, ending it after a
   * while: its exit code (null when it didn't start or was ended) and what it printed.
   */
  private async runToEnd(
    engineId: EngineId,
    codexArgs: readonly string[],
    input: string | undefined,
  ): Promise<{ code: number | null; output: string }> {
    const child = await this.spawnCodex(engineId, codexArgs);
    let output = "";
    for (const stream of [child.stdout, child.stderr]) {
      stream.setEncoding("utf8");
      stream.on("data", (chunk: string) => {
        output = (output + chunk).slice(-OUTPUT_KEPT);
      });
    }
    child.stdin.on("error", () => undefined);
    const ended = new Promise<number | null>((resolve) => {
      child.once("close", (code) => resolve(code));
      child.once("error", (error) => {
        output += `\n${error.message}`;
        resolve(null);
      });
    });
    const giveUp = setTimeout(() => {
      output += "\nit didn't end in time.";
      if (child.pid === undefined) return;
      void this.processTrees.end(child.pid).catch((error: unknown) => {
        logger.warn(`Codex, which didn't end in time, wasn't ended: ${messageOf(error)}`);
      });
    }, COMMAND_TIMEOUT_MS);
    if (input !== undefined) child.stdin.write(input);
    child.stdin.end();
    const code = await ended;
    clearTimeout(giveUp);
    return { code, output: withoutTerminalCodes(output) };
  }
}

/** One engine's device-code login, ended by its own end, by The Office after a while, or by another change. */
class RunningDeviceLogin {
  /** The device page and its one-time code, once the login prints them. */
  readonly page: Promise<{ url: string; userCode: string }>;
  readonly ended: Promise<void>;
  private output = "";

  constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly processTrees: ProcessTrees,
  ) {
    const giveUp = setTimeout(() => {
      void this.end().catch((error: unknown) => {
        logger.warn(`The Codex Sign in that ran too long didn't end: ${messageOf(error)}`);
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
    child.stdin.on("error", () => undefined);
    // The login reads nothing; its input is closed so it never waits on it.
    child.stdin.end();
    // A rejected page is awaited by the Sign in; this only keeps a late rejection quiet.
    this.page.catch(() => undefined);
  }

  async end(): Promise<void> {
    const { pid, exitCode, signalCode } = this.child;
    if (pid !== undefined && exitCode === null && signalCode === null) {
      await this.processTrees.end(pid);
    }
    await this.ended;
  }

  private pageOf(
    child: ChildProcessWithoutNullStreams,
  ): Promise<{ url: string; userCode: string }> {
    return new Promise((resolve, reject) => {
      const waited = setTimeout(
        () => reject(new SignInFailed("Codex gave no sign-in page and code.")),
        SIGN_IN_PAGE_TIMEOUT_MS,
      );
      const read = (chunk: string): void => {
        this.output = (this.output + chunk).slice(-OUTPUT_KEPT);
        const found = pageAndCode(withoutTerminalCodes(this.output));
        if (found === undefined) return;
        clearTimeout(waited);
        resolve(found);
      };
      for (const stream of [child.stdout, child.stderr]) {
        stream.setEncoding("utf8");
        stream.on("data", read);
      }
      child.once("error", (error) => {
        clearTimeout(waited);
        reject(new SignInFailed(`Codex didn't start: ${error.message}`));
      });
      // Once the page is given, this rejection is ignored.
      child.once("close", () => {
        clearTimeout(waited);
        reject(
          new SignInFailed(
            `Codex ended the Sign in: ${lastWords(withoutTerminalCodes(this.output))}`,
          ),
        );
      });
    });
  }
}

/** The device page and the one-time code in what the login printed, once both are there. */
export function pageAndCode(output: string): { url: string; userCode: string } | undefined {
  const text = output.replace(/\r\n?/g, "\n");
  const url = SIGN_IN_PAGE.exec(text)?.[0];
  const userCode = USER_CODE.exec(text)?.[1] ?? DASHED_CODE.exec(text)?.[1];
  if (url === undefined || userCode === undefined) return undefined;
  return { url, userCode };
}

export function withoutTerminalCodes(text: string): string {
  return text.replace(TERMINAL_CODES, "");
}

function lastWords(output: string): string {
  const lines = output.split(/\r?\n/).filter((line) => line.trim() !== "");
  return lines.at(-1)?.trim() ?? "it said nothing.";
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
