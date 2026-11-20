import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import type { ProcessTrees } from "../../../../platform/os/process-trees.js";
import { EngineProcess, type EngineCommand } from "../claude-code/engine-process.js";
import {
  CODEX_RESULTS,
  codexNotification,
  codexServerRequest,
  type CodexNotification,
  type CodexRequestMethod,
  type CodexRequests,
  type CodexServerRequest,
} from "./codex-protocol.js";

type RequestId = string | number;

/** JSON-RPC's code for a method the client doesn't serve. */
export const METHOD_NOT_FOUND = -32601;
/** JSON-RPC's code for a request whose parameters the client can't read. */
export const INVALID_PARAMS = -32602;
/** JSON-RPC's code for a request the client failed to answer. */
export const INTERNAL_ERROR = -32603;

/** An error answer: to the app-server's request, or from it to one of the adapter's. */
export class CodexRpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = "CodexRpcError";
  }
}

/** How the app-server's process ended, with the end of what it wrote on its standard error. */
export interface CodexExit {
  readonly code: number | null;
  readonly signal: string | null;
  readonly stderr: string;
}

/** What the session does with what the app-server sends it. */
export interface CodexRpcHandlers {
  /** Each notification the adapter reads, in the order they came. */
  readonly notification: (notification: CodexNotification) => void;
  /**
   * Answers one of the app-server's requests: the result, or a thrown `CodexRpcError` for an
   * error answer (any other throw is answered as an internal error).
   */
  readonly serverRequest: (request: CodexServerRequest) => Promise<unknown>;
  /** Told every line written to the app-server and read from it, in order, as a recording keeps them. */
  readonly wire?: CodexWireTap;
}

/** Which way a line of the app-server's JSON-RPC went. */
export type CodexWireDirection = "to-app-server" | "from-app-server";

export type CodexWireTap = (direction: CodexWireDirection, line: string) => void;

interface Pending {
  readonly method: string;
  readonly resolve: (result: unknown) => void;
  readonly reject: (error: Error) => void;
}

/**
 * The app-server's JSON-RPC over its standard streams: one JSON object per line each way, without
 * a `"jsonrpc"` member (engine check, The Codex app-server). The adapter's requests are answered
 * by id; the app-server's notifications go to the session and its requests are answered by id.
 * A line it can't read, a notification it doesn't know and an answer to no request are ignored;
 * once the output ends, every request waiting and every later one is refused.
 */
export class CodexRpc {
  private readonly pending = new Map<RequestId, Pending>();
  private nextId = 1;
  private endedWith: Error | undefined;

  constructor(
    private readonly input: Writable,
    output: Readable,
    private readonly handlers: CodexRpcHandlers,
  ) {
    // A write after the app-server has gone fails here, not as an uncaught error.
    input.on("error", (error) => this.end(error));
    const lines = createInterface({ input: output, crlfDelay: Infinity });
    lines.on("line", (line) => this.receive(line));
    lines.on("close", () => this.end(new Error("The Codex app-server's output ended.")));
  }

  /** Whether the output has ended, after which nothing more comes or is sent. */
  get ended(): boolean {
    return this.endedWith !== undefined;
  }

  /** Sends a request and waits for its answer, refused as a `CodexRpcError` on an error answer. */
  request<M extends CodexRequestMethod>(
    method: M,
    params: CodexRequests[M]["params"],
  ): Promise<CodexRequests[M]["result"]> {
    if (this.endedWith !== undefined) return Promise.reject(this.endedWith);
    const id = this.nextId++;
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { method, resolve, reject });
      this.send(params === undefined ? { id, method } : { id, method, params });
    }).then((result) => {
      const parsed = CODEX_RESULTS[method].safeParse(result);
      if (!parsed.success) {
        throw new Error(
          `The Codex app-server answered ${method} unexpectedly: ${parsed.error.message}`,
        );
      }
      return parsed.data;
    });
  }

  /** Sends a notification, such as `initialized`. */
  notify(method: string, params?: unknown): void {
    if (this.endedWith !== undefined) return;
    this.send(params === undefined ? { method } : { method, params });
  }

  /** Refuses whatever still waits; what comes after is ignored. */
  end(reason: Error): void {
    if (this.endedWith !== undefined) return;
    this.endedWith = reason;
    for (const { method, reject } of this.pending.values()) {
      reject(new Error(`${reason.message} It hadn't answered ${method}.`));
    }
    this.pending.clear();
  }

  private send(message: Record<string, unknown>): void {
    const line = JSON.stringify(message);
    this.handlers.wire?.("to-app-server", line);
    this.input.write(`${line}\n`);
  }

  private receive(line: string): void {
    if (this.endedWith !== undefined || line.trim() === "") return;
    this.handlers.wire?.("from-app-server", line);
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (typeof message !== "object" || message === null || Array.isArray(message)) return;
    const { id, method, params, result, error } = message as Record<string, unknown>;
    if (typeof method === "string") {
      if (isRequestId(id)) {
        void this.answer(id, method, params);
      } else {
        const notification = codexNotification(method, params);
        if (notification !== undefined) this.handlers.notification(notification);
      }
      return;
    }
    if (!isRequestId(id)) return;
    const pending = this.pending.get(id);
    if (pending === undefined) return;
    this.pending.delete(id);
    if (error === undefined) {
      pending.resolve(result);
    } else {
      const { code, message: words } = errorOf(error);
      pending.reject(new CodexRpcError(code, `${pending.method} failed: ${words}`));
    }
  }

  private async answer(id: RequestId, method: string, params: unknown): Promise<void> {
    const request = codexServerRequest(method, params);
    try {
      if (request.kind === "unknown") {
        throw new CodexRpcError(METHOD_NOT_FOUND, `The Office doesn't answer ${method}.`);
      }
      if (request.kind === "malformed") {
        throw new CodexRpcError(
          INVALID_PARAMS,
          `The Office couldn't read ${method}: ${request.problem}`,
        );
      }
      const result = await this.handlers.serverRequest(request.request);
      if (this.endedWith === undefined) this.send({ id, result });
    } catch (failure) {
      if (this.endedWith !== undefined) return;
      const error =
        failure instanceof CodexRpcError
          ? { code: failure.code, message: failure.message }
          : {
              code: INTERNAL_ERROR,
              message: failure instanceof Error ? failure.message : String(failure),
            };
      this.send({ id, error });
    }
  }
}

/** How long a closed app-server has to end by itself before The Office ends its tree. */
const EXIT_GRACE_MS = 5_000;

/**
 * One session's `codex app-server` process (spec §5.4 Defaults), started through the engine's
 * process so that what it starts ends with it, and its JSON-RPC connection.
 */
export class CodexAppServer {
  /**
   * Settles once the process has ended and its output closed, however it ended, with how; never
   * rejects. Its JSON-RPC connection has ended by then.
   */
  readonly exited: Promise<CodexExit>;
  readonly rpc: CodexRpc;
  private readonly input: Writable;
  private readonly processId: number | undefined;

  private constructor(
    private readonly processTrees: ProcessTrees,
    command: EngineCommand,
    handlers: CodexRpcHandlers,
  ) {
    const engineProcess = new EngineProcess(processTrees);
    const child = engineProcess.spawn(command);
    this.processId = child.pid;
    this.input = child.stdin;
    this.rpc = new CodexRpc(child.stdin, child.stdout, handlers);
    this.exited = new Promise((resolve) => {
      child.once("error", (error) =>
        resolve({
          code: null,
          signal: null,
          stderr: `${engineProcess.stderr}\n${error.message}`.trim(),
        }),
      );
      // After the output has closed too, so the last notifications are read first.
      child.once("close", (code, signal) =>
        resolve({ code, signal, stderr: engineProcess.stderr }),
      );
    });
    void this.exited.then((exit) => this.rpc.end(new Error(codexExitWords(exit))));
  }

  /** Starts the app-server; whether it runs shows at its first request's answer, or `exited`. */
  static start(
    processTrees: ProcessTrees,
    command: EngineCommand,
    handlers: CodexRpcHandlers,
  ): CodexAppServer {
    return new CodexAppServer(processTrees, command, handlers);
  }

  /**
   * Ends the app-server as a session's end does: its input closed, its tree ended if it hasn't
   * gone after a grace period, then whatever it left running.
   */
  async close(): Promise<void> {
    this.rpc.end(new Error("The Codex session has ended."));
    this.input.end();
    const exited = await Promise.race([
      this.exited.then(() => true),
      delay(EXIT_GRACE_MS, false, { ref: false }),
    ]);
    if (!exited) await this.endTree();
    await this.endLeftovers();
  }

  /**
   * Ends the app-server and every process it started at once, as Stop does: `turn/interrupt`
   * leaves a running command to run on (engine check, codex.interrupt).
   */
  async kill(): Promise<void> {
    this.rpc.end(new Error("The Codex app-server was stopped."));
    await this.endTree();
    await this.endLeftovers();
  }

  private async endTree(): Promise<void> {
    if (this.processId === undefined) return;
    await this.processTrees.end(this.processId);
    // A process it started outside its tree may still hold its output open.
    await Promise.race([this.exited, delay(EXIT_GRACE_MS, undefined, { ref: false })]);
  }

  private async endLeftovers(): Promise<void> {
    if (this.processId !== undefined) await this.processTrees.endLeftovers(this.processId);
  }
}

/** How the app-server ended, in words, with what it last wrote on its standard error. */
export function codexExitWords({ code, signal, stderr }: CodexExit): string {
  const how =
    code === null
      ? signal === null
        ? "failed to start"
        : `ended by ${signal}`
      : `exited with ${code}`;
  return stderr === "" ? `The Codex app-server ${how}.` : `The Codex app-server ${how}: ${stderr}`;
}

function isRequestId(id: unknown): id is RequestId {
  return typeof id === "string" || typeof id === "number";
}

function errorOf(error: unknown): { code: number; message: string } {
  if (typeof error === "object" && error !== null) {
    const { code, message } = error as Record<string, unknown>;
    return {
      code: typeof code === "number" ? code : INTERNAL_ERROR,
      message: typeof message === "string" ? message : JSON.stringify(error),
    };
  }
  return { code: INTERNAL_ERROR, message: String(error) };
}
