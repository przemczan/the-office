import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { AsyncChannel } from "../../../../platform/streams/async-channel.js";

/** How the engine answers a control request. */
interface ControlAnswer {
  readonly subtype: "success" | "error";
  readonly request_id: string;
  readonly response?: unknown;
  readonly error?: string;
}

interface PendingRequest {
  readonly resolve: (response: unknown) => void;
  readonly reject: (reason: unknown) => void;
}

type Line = { readonly type: string } & Readonly<Record<string, unknown>>;

/**
 * The binary's stream-json protocol in `-p` (docs/engine-check.md, "The `-p` fallback"): messages
 * and control requests written to its input, a line each; stream messages and the answers to the
 * requests read from its output. The protocol's own lines never reach `messages`.
 */
export class StreamJson {
  /** The stream's messages until the engine ends; it fails when the engine exits with an error. */
  readonly messages = new AsyncChannel<SDKMessage>();
  private readonly pending = new Map<string, PendingRequest>();
  /** Why no request is answered any more, once the engine ended. */
  private stopped: Error | undefined;

  constructor(private readonly engine: ChildProcessWithoutNullStreams) {
    // A write after the engine ended fails here; its exit already ended the session.
    engine.stdin.on("error", () => undefined);
    engine.once("error", (error) => this.ended(error));
    // After its output closed, so every line it wrote has been read.
    engine.once("close", (code, signal) =>
      this.ended(code === 0 ? undefined : new Error(`the engine exited with ${code ?? signal}`)),
    );
    createInterface({ input: engine.stdout }).on("line", (line) => this.read(line));
  }

  send(message: unknown): void {
    if (this.engine.stdin.writable) this.engine.stdin.write(`${JSON.stringify(message)}\n`);
  }

  /** Sends a control request and waits for the engine's answer to it. */
  request<Response>(
    subtype: string,
    fields: Readonly<Record<string, unknown>> = {},
  ): Promise<Response> {
    if (this.stopped !== undefined) return Promise.reject(this.stopped);
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve: resolve as (response: unknown) => void, reject });
      this.send({
        type: "control_request",
        request_id: requestId,
        request: { subtype, ...fields },
      });
    });
  }

  /** No more input: the engine ends once it has finished the turn it runs. */
  endInput(): void {
    this.engine.stdin.end();
  }

  private read(text: string): void {
    if (text.trim() === "") return;
    let line: Line;
    try {
      line = JSON.parse(text) as Line;
    } catch {
      // Not a protocol line, such as a warning the engine printed; it carries no message.
      return;
    }
    switch (line.type) {
      case "control_response":
        this.settle(line["response"] as ControlAnswer);
        return;
      case "control_request":
        this.refuse(line["request_id"]);
        return;
      case "control_cancel_request":
        return;
      default:
        this.messages.push(line as unknown as SDKMessage);
    }
  }

  /**
   * The engine asks its host only for what The Office never sets up (permission prompts, SDK
   * hooks, SDK MCP servers); an unanswered request would hang the session.
   */
  private refuse(requestId: unknown): void {
    this.send({
      type: "control_response",
      response: {
        subtype: "error",
        request_id: requestId,
        error: "The Office answers no requests.",
      },
    });
  }

  private settle(answer: ControlAnswer): void {
    const pending = this.pending.get(answer.request_id);
    this.pending.delete(answer.request_id);
    if (answer.subtype === "success") pending?.resolve(answer.response);
    else
      pending?.reject(
        new Error(`The engine refused a request: ${answer.error ?? "no reason given"}`),
      );
  }

  private ended(failure: Error | undefined): void {
    const stopped = failure ?? new Error("the engine ended before answering");
    this.stopped = stopped;
    for (const pending of this.pending.values()) pending.reject(stopped);
    this.pending.clear();
    if (!this.messages.isOpen) return;
    if (failure === undefined) this.messages.close();
    else this.messages.fail(failure);
  }
}
