import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { dirname } from "node:path";
import { promisify } from "node:util";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import type { OfficeTool } from "../claude-code-p/office-tool-server.ts";
import type { EndpointRequests } from "../claude-code-p/local-endpoints.ts";
import { OFFICE_TOOL_SERVER } from "../office-options.ts";
import type { TokenUsage } from "../recorded-session.ts";
import { codexAppServerArguments, codexEnvironment } from "./arguments.ts";
import {
  errorLine,
  INTERNAL_ERROR,
  METHOD_NOT_FOUND,
  notificationLine,
  readMessage,
  requestLine,
  resultLine,
  type IncomingMessage,
  type RequestId,
} from "./json-rpc.ts";
import { OfficeToolHttpServer } from "./office-tool-http-server.ts";
import {
  CODEX_CHECK_EFFORT,
  CODEX_CHECK_MODEL,
  CODEX_OVERRIDES,
  OFFICE_TOOL_TOKEN_VARIABLE,
} from "./options.ts";
import { pinnedCodexPath } from "./pinned-codex.ts";
import {
  APPROVAL_REQUESTS,
  type Account,
  type ApprovalRequestParams,
  type AskForApproval,
  type GetAccountResponse,
  type InitializeResponse,
  type ItemNotification,
  type SandboxMode,
  type ThreadItem,
  type ThreadOpenedResponse,
  type ThreadTokenUsageUpdatedNotification,
  type Turn,
  type TurnCompletedNotification,
  type TurnStartResponse,
} from "./protocol.ts";
import { tokensSpent } from "./token-usage.ts";

/** How long a closed session's app-server has to end by itself before the check ends it. */
const EXIT_GRACE_MS = 10_000;

export type ApprovalAnswer = "accept" | "decline" | "cancel";

/** One approval request the app-server sent, as a hook call is recorded on the Claude routes. */
export interface ApprovalCall {
  readonly method: string;
  readonly params: ApprovalRequestParams;
  /** How many messages had arrived when the request came. */
  readonly messageIndex: number;
  answer?: ApprovalAnswer;
}

/** A notification or server request the app-server sent, in order. */
export interface CodexMessage {
  readonly method: string;
  readonly params: unknown;
  /** Set on a server request, which the check answers. */
  readonly request?: true;
}

export type ApprovalDecider = (
  call: ApprovalCall,
  session: CodexSession,
) => ApprovalAnswer | Promise<ApprovalAnswer>;

export interface CodexSessionSpec {
  /** The worktree, the thread's `cwd`. */
  readonly repository: string;
  /** Under test; `untrusted` when omitted. */
  readonly approvalPolicy?: AskForApproval;
  /** `workspace-write` when omitted. */
  readonly sandbox?: SandboxMode;
  /** Answers each approval request; accepts when omitted. */
  readonly decide?: ApprovalDecider;
  /** Served over MCP on `127.0.0.1`; no MCP server is configured when omitted. */
  readonly officeTools?: readonly OfficeTool[];
}

interface PendingRequest {
  readonly method: string;
  readonly resolve: (result: unknown) => void;
  readonly reject: (reason: unknown) => void;
}

interface Waiter {
  readonly predicate: (message: CodexMessage) => boolean;
  cursor: number;
  readonly resolve: (index: number) => void;
  readonly reject: (reason: unknown) => void;
}

/**
 * One session on the pinned `codex app-server` (spec §5.4 Defaults, the Codex engine): one process
 * speaking JSON-RPC over stdio, with `CODEX_HOME` the account folder. Every notification and server
 * request is recorded; approval requests are answered by the check's decide function and recorded as
 * approval calls. Settings go in only through `-c` overrides and `thread/start` parameters.
 */
export class CodexSession {
  readonly approvalCalls: ApprovalCall[] = [];
  /** Threads this session started, which the runner deletes after the check. */
  readonly startedThreadIds: string[] = [];
  /** The account folder, the app-server's `CODEX_HOME`. */
  readonly codexHome: string;
  readonly initializeResponse: InitializeResponse;
  readonly account: Account | null;
  private readonly connection: AppServerConnection;
  private readonly spec: CodexSessionSpec;
  private readonly officeTools: OfficeToolHttpServer | undefined;
  private threadIdValue: string | undefined;
  private turnEndCursor = 0;

  private constructor(
    codexHome: string,
    connection: AppServerConnection,
    spec: CodexSessionSpec,
    officeTools: OfficeToolHttpServer | undefined,
    initializeResponse: InitializeResponse,
    account: Account | null,
  ) {
    this.codexHome = codexHome;
    this.connection = connection;
    this.spec = spec;
    this.officeTools = officeTools;
    this.initializeResponse = initializeResponse;
    this.account = account;
  }

  static async start(
    codexHome: string,
    spec: CodexSessionSpec,
    signal: AbortSignal,
  ): Promise<CodexSession> {
    const officeTools =
      spec.officeTools === undefined
        ? undefined
        : await OfficeToolHttpServer.start(spec.officeTools);
    const connection = new AppServerConnection(
      codexHome,
      spec.repository,
      officeTools === undefined ? {} : { [OFFICE_TOOL_TOKEN_VARIABLE]: officeTools.token },
      signal,
    );
    try {
      const initializeResponse = (await connection.request("initialize", {
        clientInfo: { name: "office_engine_check", title: "The Office engine check", version: "1" },
        capabilities: { experimentalApi: true, requestAttestation: false },
      })) as InitializeResponse;
      connection.notify("initialized");
      const { account } = (await connection.request("account/read", {})) as GetAccountResponse;
      const session = new CodexSession(
        codexHome,
        connection,
        spec,
        officeTools,
        initializeResponse,
        account,
      );
      connection.onServerRequest = (id, method, params) =>
        session.answerServerRequest(id, method, params);
      return session;
    } catch (error) {
      await connection.close();
      await officeTools?.close();
      throw error;
    }
  }

  get threadId(): string {
    if (this.threadIdValue === undefined) {
      throw new Error("No thread started or resumed on this session");
    }
    return this.threadIdValue;
  }

  get stderr(): string {
    return this.connection.stderr;
  }

  /** The app-server's process id, undefined when it didn't start. */
  get processId(): number | undefined {
    return this.connection.processId;
  }

  /** Every notification and server request, in order. */
  get messages(): readonly CodexMessage[] {
    return this.connection.messages;
  }

  /** Requests to the Office tool server, with the session's token or refused without it. */
  get officeToolRequests(): EndpointRequests | undefined {
    return this.officeTools?.requests;
  }

  /** The MCP methods the app-server sent the Office tool server, in order. */
  get officeToolMethods(): readonly string[] {
    return this.officeTools?.methods ?? [];
  }

  request(method: string, params: unknown = {}): Promise<unknown> {
    return this.connection.request(method, params);
  }

  async startThread(): Promise<ThreadOpenedResponse> {
    const opened = (await this.request(
      "thread/start",
      await this.threadParameters(),
    )) as ThreadOpenedResponse;
    this.threadIdValue = opened.thread.id;
    this.startedThreadIds.push(opened.thread.id);
    return opened;
  }

  async resumeThread(threadId: string): Promise<ThreadOpenedResponse> {
    const opened = (await this.request("thread/resume", {
      threadId,
      ...(await this.threadParameters()),
    })) as ThreadOpenedResponse;
    this.threadIdValue = opened.thread.id;
    return opened;
  }

  /** Starts a turn on the session's thread and returns it as started. */
  async startTurn(text: string, options: { outputSchema?: unknown } = {}): Promise<Turn> {
    const { turn } = (await this.request("turn/start", {
      threadId: this.threadId,
      input: [textInput(text)],
      effort: CODEX_CHECK_EFFORT,
      ...(options.outputSchema === undefined ? {} : { outputSchema: options.outputSchema }),
    })) as TurnStartResponse;
    return turn;
  }

  async interrupt(turnId: string): Promise<void> {
    await this.request("turn/interrupt", { threadId: this.threadId, turnId });
  }

  /** The next turn's ending not yet returned by an earlier call, as `turn/completed` reports it. */
  async nextTurnEnd(): Promise<Turn> {
    const index = await this.connection.waitForIndex(
      (message) => message.method === "turn/completed",
      this.turnEndCursor,
    );
    this.turnEndCursor = index + 1;
    return ((this.messages[index] as CodexMessage).params as TurnCompletedNotification).turn;
  }

  /** Waits for a notification after `from`, such as an item's start. */
  async waitFor<T>(
    method: string,
    predicate: (params: T) => boolean = () => true,
    from = 0,
  ): Promise<T> {
    const index = await this.connection.waitForIndex(
      (message) => message.method === method && predicate(message.params as T),
      from,
    );
    return this.messages[index]?.params as T;
  }

  /** The items the turn completed, or every turn when none is named, in order. */
  completedItems(turnId?: string): ThreadItem[] {
    return this.messages
      .filter((message) => message.method === "item/completed")
      .map((message) => message.params as ItemNotification)
      .filter((notification) => turnId === undefined || notification.turnId === turnId)
      .map((notification) => notification.item);
  }

  /** The turn's last agent message, its answer. */
  finalMessage(turnId: string): string | undefined {
    return this.completedItems(turnId)
      .filter(
        (item): item is Extract<ThreadItem, { type: "agentMessage" }> =>
          item.type === "agentMessage",
      )
      .at(-1)?.text;
  }

  /** Tokens this process spent, from `thread/tokenUsage/updated`. */
  tokens(): TokenUsage {
    return tokensSpent(
      this.messages
        .filter((message) => message.method === "thread/tokenUsage/updated")
        .map((message) => message.params as ThreadTokenUsageUpdatedNotification),
    );
  }

  /** Deletes threads from the account folder, archiving one that can't be deleted. */
  async deleteThreads(threadIds: readonly string[]): Promise<void> {
    for (const threadId of threadIds) {
      await this.request("thread/delete", { threadId }).catch(() =>
        this.request("thread/archive", { threadId }),
      );
    }
  }

  async close(): Promise<void> {
    await this.connection.close();
    await this.officeTools?.close();
  }

  /**
   * The Office's thread options. The repository is named untrusted, keyed by its main checkout as
   * Codex keys it: otherwise a persisted thread marks it trusted in the folder's `config.toml`, and
   * its own `.codex/config.toml` joins the settings (`codex.start`).
   */
  private async threadParameters(): Promise<Record<string, unknown>> {
    const { spec } = this;
    const repositoryRoot = await mainCheckout(spec.repository);
    return {
      cwd: spec.repository,
      model: CODEX_CHECK_MODEL,
      approvalPolicy: spec.approvalPolicy ?? "untrusted",
      sandbox: spec.sandbox ?? "workspace-write",
      config: {
        model_reasoning_effort: CODEX_CHECK_EFFORT,
        projects: { [repositoryRoot]: { trust_level: "untrusted" } },
        ...(this.officeTools === undefined
          ? {}
          : {
              mcp_servers: {
                [OFFICE_TOOL_SERVER]: {
                  url: this.officeTools.url,
                  bearer_token_env_var: OFFICE_TOOL_TOKEN_VARIABLE,
                },
              },
            }),
      },
    };
  }

  private async answerServerRequest(id: RequestId, method: string, params: unknown): Promise<void> {
    if (!isApprovalRequest(method)) {
      this.connection.answerError(id, {
        code: METHOD_NOT_FOUND,
        message: "The engine check answers no such request.",
      });
      return;
    }
    const call: ApprovalCall = {
      method,
      params: params as ApprovalRequestParams,
      messageIndex: this.messages.length - 1,
    };
    this.approvalCalls.push(call);
    call.answer = (await this.spec.decide?.(call, this)) ?? "accept";
    this.connection.answer(id, approvalResponse(method, call.answer));
  }
}

/** The app-server process and its JSON-RPC connection: requests, answers and the recorded messages. */
class AppServerConnection {
  readonly messages: CodexMessage[] = [];
  onServerRequest: ((id: RequestId, method: string, params: unknown) => Promise<void>) | undefined;
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<RequestId, PendingRequest>();
  private readonly waiters = new Set<Waiter>();
  private readonly stderrChunks: string[] = [];
  private readonly exited: Promise<void>;
  private nextId = 1;
  private failure: Error | undefined;
  private ended = false;
  private readonly signal: AbortSignal;

  constructor(
    codexHome: string,
    cwd: string,
    variables: Record<string, string>,
    signal: AbortSignal,
  ) {
    this.signal = signal;
    const child = spawn(pinnedCodexPath(), codexAppServerArguments(CODEX_OVERRIDES), {
      cwd,
      env: codexEnvironment(codexHome, variables),
      stdio: "pipe",
      windowsHide: true,
    });
    this.child = child;
    this.exited = new Promise((resolve) => {
      child.once("exit", () => resolve());
      child.once("error", () => resolve());
    });
    child.stdin.on("error", (error) => this.stderrChunks.push(`stdin: ${error.message}\n`));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => this.stderrChunks.push(chunk));
    child.once("error", (error) => this.end(error));
    child.once("exit", (code, exitSignal) =>
      this.end(
        code === 0
          ? undefined
          : new Error(`The app-server exited with ${code ?? exitSignal}: ${this.stderr}`),
      ),
    );
    signal.addEventListener(
      "abort",
      () => {
        child.kill("SIGKILL");
        this.rejectWaiters(signal.reason);
      },
      { once: true },
    );
    createInterface({ input: child.stdout }).on("line", (line) => {
      if (line.trim() !== "") this.receive(readMessage(line));
    });
  }

  get stderr(): string {
    return this.stderrChunks.join("");
  }

  get processId(): number | undefined {
    return this.child.pid;
  }

  request(method: string, params: unknown): Promise<unknown> {
    if (this.ended) {
      return Promise.reject(this.failure ?? new Error(`The app-server ended before ${method}`));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { method, resolve, reject });
      this.child.stdin.write(requestLine(id, method, params));
    });
  }

  notify(method: string, params?: unknown): void {
    this.child.stdin.write(notificationLine(method, params));
  }

  answer(id: RequestId, result: unknown): void {
    this.child.stdin.write(resultLine(id, result));
  }

  answerError(id: RequestId, error: { code: number; message: string }): void {
    this.child.stdin.write(errorLine(id, error));
  }

  waitForIndex(predicate: (message: CodexMessage) => boolean, from: number): Promise<number> {
    if (this.signal.aborted) {
      return Promise.reject(this.signal.reason);
    }
    return new Promise((resolve, reject) => {
      this.waiters.add({ predicate, cursor: from, resolve, reject });
      this.notifyWaiters();
    });
  }

  async close(): Promise<void> {
    this.child.stdin.end();
    const exited = await Promise.race([
      this.exited.then(() => true),
      delay(EXIT_GRACE_MS, false, { ref: false }),
    ]);
    if (!exited) {
      this.child.kill("SIGKILL");
      await this.exited;
    }
  }

  private receive(message: IncomingMessage): void {
    switch (message.kind) {
      case "response":
      case "error": {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.kind === "response") {
          pending?.resolve(message.result);
        } else {
          pending?.reject(
            new Error(`${pending.method} failed: ${message.error.message} (${message.error.code})`),
          );
        }
        return;
      }
      case "request":
        this.record({ method: message.method, params: message.params, request: true });
        // A decide function that throws fails the request, not the whole run, and shows in the report.
        this.onServerRequest?.(message.id, message.method, message.params).catch(
          (error: unknown) => {
            this.stderrChunks.push(`answering ${message.method}: ${String(error)}\n`);
            this.answerError(message.id, { code: INTERNAL_ERROR, message: String(error) });
          },
        );
        return;
      case "notification":
        this.record({ method: message.method, params: message.params });
    }
  }

  private record(message: CodexMessage): void {
    this.messages.push(message);
    this.notifyWaiters();
  }

  private end(failure: Error | undefined): void {
    this.failure ??= failure;
    this.ended = true;
    for (const pending of this.pending.values()) {
      pending.reject(
        failure ?? new Error(`The app-server ended before answering ${pending.method}`),
      );
    }
    this.pending.clear();
    this.notifyWaiters();
  }

  private notifyWaiters(): void {
    for (const waiter of this.waiters) {
      for (; waiter.cursor < this.messages.length; waiter.cursor++) {
        if (waiter.predicate(this.messages[waiter.cursor] as CodexMessage)) {
          this.waiters.delete(waiter);
          waiter.resolve(waiter.cursor);
          break;
        }
      }
      if (this.ended && this.waiters.has(waiter)) {
        this.waiters.delete(waiter);
        waiter.reject(this.failure ?? new Error("The app-server ended before the awaited message"));
      }
    }
  }

  private rejectWaiters(reason: unknown): void {
    for (const waiter of this.waiters) {
      waiter.reject(reason);
    }
    this.waiters.clear();
  }
}

/** The main checkout of a repository or of a worktree of one, from its common git folder. */
async function mainCheckout(repository: string): Promise<string> {
  const { stdout } = await promisify(execFile)("git", [
    "-C",
    repository,
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir",
  ]);
  return dirname(stdout.trim());
}

function textInput(text: string): Record<string, unknown> {
  return { type: "text", text, text_elements: [] };
}

function isApprovalRequest(method: string): boolean {
  return (Object.values(APPROVAL_REQUESTS) as string[]).includes(method);
}

/** The answer each kind of approval request takes (`ServerRequest`'s responses). */
function approvalResponse(method: string, answer: ApprovalAnswer): unknown {
  switch (method) {
    case APPROVAL_REQUESTS.mcpElicitation:
      return { action: answer, content: null, _meta: null };
    case APPROVAL_REQUESTS.permissions:
      return { permissions: {}, scope: "turn" };
    default:
      return { decision: answer };
  }
}
