import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { ReadBuffer, serializeMessage } from "@modelcontextprotocol/sdk/shared/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { startProgram, type Program } from "../os/program.js";
import type { ProcessTrees } from "../os/process-trees.js";

/** How much of the server's standard error is kept: its last lines say why it failed. */
const OUTPUT_KEPT = 4000;

/** How long a closed server has to end by itself before The Office ends it. */
const EXIT_GRACE_MS = 2000;

/**
 * How long, after the server's end, its output may stay open: a process it left that escaped its
 * tree can hold it open for ever, and the server's end must still be told.
 */
const OUTPUT_GRACE_MS = 2000;

/**
 * MCP's stdio transport over a program The Office starts itself. The SDK's own transport signals
 * only the process it started, which on Windows is cmd.exe running `npx.cmd`, so the server
 * would outlive it; this one ends the process tree on close.
 */
export class ProgramStdioTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  private child: ChildProcessWithoutNullStreams | undefined;
  private exited: Promise<void> = Promise.resolve();
  private outputRead: Promise<void> = Promise.resolve();
  private readonly readBuffer = new ReadBuffer();
  private outputTail = "";
  private closing: Promise<void> | undefined;
  private closed = false;

  constructor(
    private readonly program: Program,
    private readonly processTrees: ProcessTrees,
  ) {}

  /** What the end of the server's standard error said. */
  get output(): string {
    return this.outputTail.trim();
  }

  start(): Promise<void> {
    if (this.child) return Promise.reject(new Error("The MCP server's process has started."));
    return new Promise((resolve, reject) => {
      const child = startProgram(this.program, this.processTrees);
      this.child = child;
      let spawned = false;
      this.exited = new Promise((ended) => {
        child.once("exit", () => ended());
        child.once("error", () => ended());
      });
      // Node may tell of the exit before the server's last words on its standard error are read;
      // "close" comes once its output has ended, every process holding it gone.
      this.outputRead = new Promise((read) => {
        child.once("close", () => read());
        child.once("error", () => read());
      });
      child.once("spawn", () => {
        spawned = true;
        resolve();
      });
      child.on("error", (error) => {
        if (spawned) this.onerror?.(error);
        else reject(error);
        this.notifyClosed();
      });
      child.once("exit", () => {
        void within(this.outputRead, OUTPUT_GRACE_MS).then(() => this.notifyClosed());
      });
      child.stdin.on("error", (error) => this.onerror?.(error));
      child.stdout.on("data", (chunk: Buffer) => this.read(chunk));
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        this.outputTail = (this.outputTail + chunk).slice(-OUTPUT_KEPT);
      });
    });
  }

  send(message: JSONRPCMessage): Promise<void> {
    const input = this.child?.stdin;
    if (!input?.writable) {
      return Promise.reject(new Error("The MCP server's process isn't running."));
    }
    return new Promise((resolve) => {
      if (input.write(serializeMessage(message))) resolve();
      else input.once("drain", resolve);
    });
  }

  /**
   * Closes its input, waits a moment for the server to end by itself, ends it if it won't, then
   * ends whatever it left running.
   */
  close(): Promise<void> {
    this.closing ??= this.end();
    return this.closing;
  }

  private async end(): Promise<void> {
    const processId = this.child?.pid;
    if (this.child === undefined || processId === undefined) {
      this.notifyClosed();
      return;
    }
    const child = this.child;
    child.stdin.end();
    if (!(await within(this.exited, EXIT_GRACE_MS))) {
      await this.processTrees.end(processId).catch(() => undefined);
    }
    await this.processTrees.endLeftovers(processId).catch(() => undefined);
    if (!(await within(this.outputRead, OUTPUT_GRACE_MS))) {
      child.stdout.destroy();
      child.stderr.destroy();
    }
    this.notifyClosed();
  }

  private read(chunk: Buffer): void {
    this.readBuffer.append(chunk);
    for (;;) {
      try {
        const message = this.readBuffer.readMessage();
        if (message === null) return;
        this.onmessage?.(message);
      } catch (error) {
        // A line that isn't JSON-RPC, such as a server's stray log line, is skipped.
        this.onerror?.(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  private notifyClosed(): void {
    if (this.closed) return;
    this.closed = true;
    this.onclose?.();
  }
}

/** Whether `settled` settles within `milliseconds`. */
async function within(settled: Promise<void>, milliseconds: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), milliseconds);
  });
  try {
    return await Promise.race([settled.then(() => true as const), timedOut]);
  } finally {
    clearTimeout(timer);
  }
}
