import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProcessTrees } from "../../../../platform/os/process-trees.js";
import type { UsageWindowStart } from "../../ports/agent-engine.js";
import type { TokenUsage } from "../../ports/session-events.js";
import type { EngineCommand } from "../claude-code/engine-process.js";
import { engineRead, type EngineReadLimits } from "../claude-code/engine-read.js";
import { codexTokens } from "./codex-events.js";
import type { Effort } from "../../ports/session-options.js";
import {
  codexUserInput,
  type CodexNotification,
  type CodexRequests,
  type CodexTurn,
} from "./codex-protocol.js";
import {
  CodexAppServer,
  CodexRpcError,
  METHOD_NOT_FOUND,
  type CodexRpcHandlers,
  type CodexWireTap,
} from "./codex-rpc.js";

/** The model the turn that starts a Codex engine's 5-hour window runs on: the cheapest. */
export const CODEX_WINDOW_START_MODEL = "gpt-6-luna";

/** The effort of that turn: the least. */
export const CODEX_WINDOW_START_EFFORT: Effort = "low";

/** How the app-server is told who its client is. */
const CLIENT_INFO = { name: "the_office", title: "The Office", version: "1" } as const;

const NO_TOKENS: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };

/**
 * `thread/start`'s settings for a window start: an ephemeral thread, so none is written to the
 * engine's folder, on the cheapest model, in the read-only sandbox of an empty folder with no
 * approval asked, and no MCP server or developer instructions of a session's.
 */
export function codexWindowStartThread(cwd: string): CodexRequests["thread/start"]["params"] {
  return {
    cwd,
    model: CODEX_WINDOW_START_MODEL,
    approvalPolicy: "never",
    sandbox: "read-only",
    ephemeral: true,
  };
}

/** What a window start on Codex runs on. */
export interface CodexWindowStart {
  /** The app-server's command, run in the engine's folder with `CODEX_HOME` set to it. */
  readonly command: EngineCommand;
  readonly processTrees: ProcessTrees;
  /** Told every line of the app-server, as a recording keeps them. */
  readonly wire?: CodexWireTap | undefined;
}

/**
 * Starts the account's 5-hour window with one turn of `prompt` on an app-server started for it
 * alone (spec §5.4.6): an ephemeral thread in a fresh empty folder, removed after, its tokens the
 * thread's. The app-server and what it started end before it answers, however it went
 * (`engineRead`).
 */
export async function startCodexUsageWindow(
  { command, processTrees, wire }: CodexWindowStart,
  prompt: string,
  limits: EngineReadLimits,
): Promise<UsageWindowStart> {
  let server: CodexAppServer | undefined;
  let folder: string | undefined;
  return engineRead(
    limits,
    async () => {
      folder = await mkdtemp(join(tmpdir(), "office-window-start-"));
      const turn = new TurnWatch();
      const handlers: CodexRpcHandlers = {
        notification: (notification) => turn.read(notification),
        serverRequest: ({ method }) =>
          Promise.reject(
            new CodexRpcError(METHOD_NOT_FOUND, `The Office doesn't answer ${method}.`),
          ),
        ...(wire === undefined ? {} : { wire }),
      };
      server = CodexAppServer.start(processTrees, command, handlers);
      const exited = server.exited.then((exit) => {
        throw new Error(
          `The Codex app-server ended before the turn did (${exit.code ?? exit.signal}).`,
        );
      });
      exited.catch(() => undefined);
      await server.rpc.request("initialize", {
        clientInfo: CLIENT_INFO,
        capabilities: { experimentalApi: true, requestAttestation: false },
      });
      server.rpc.notify("initialized");
      const opened = await server.rpc.request("thread/start", codexWindowStartThread(folder));
      turn.threadId = opened.thread.id;
      await server.rpc.request("turn/start", {
        threadId: opened.thread.id,
        input: codexUserInput(prompt),
        effort: CODEX_WINDOW_START_EFFORT,
      });
      const ended = await Promise.race([turn.ended, exited]);
      if (ended.status !== "completed") {
        throw new Error(
          `The turn that starts the 5-hour window ended ${ended.status}: ${ended.error?.message ?? "no reason given"}`,
        );
      }
      return { tokens: turn.tokens, model: opened.model };
    },
    async () => {
      await server?.kill();
      if (folder !== undefined) await rm(folder, { recursive: true, force: true });
    },
  );
}

/** Follows the one turn of a window start's thread: its tokens so far and its end. */
class TurnWatch {
  threadId: string | undefined;
  tokens: TokenUsage = NO_TOKENS;
  readonly ended: Promise<CodexTurn>;
  private end!: (turn: CodexTurn) => void;

  constructor() {
    this.ended = new Promise((resolve) => (this.end = resolve));
  }

  read(notification: CodexNotification): void {
    if (notification.method === "thread/tokenUsage/updated" && this.ours(notification.params)) {
      this.tokens = codexTokens(notification.params.tokenUsage.total);
    } else if (notification.method === "turn/completed" && this.ours(notification.params)) {
      this.end(notification.params.turn);
    }
  }

  private ours({ threadId }: { readonly threadId: string }): boolean {
    return this.threadId === undefined || threadId === this.threadId;
  }
}
