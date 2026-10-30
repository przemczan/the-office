import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { StreamJson } from "./stream-json.js";

/** An engine's process whose output the test writes and whose input it reads. */
class FakeEngine extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  private readonly written: unknown[] = [];

  constructor() {
    super();
    this.stdin.setEncoding("utf8");
    this.stdin.on("data", (chunk: string) => {
      for (const line of chunk.split("\n")) if (line !== "") this.written.push(JSON.parse(line));
    });
  }

  get asChild(): ChildProcessWithoutNullStreams {
    return this as unknown as ChildProcessWithoutNullStreams;
  }

  /** What was written to the engine's input, once it has been read. */
  async input(): Promise<unknown[]> {
    await new Promise((resolve) => setImmediate(resolve));
    return this.written;
  }

  writes(...lines: unknown[]): void {
    for (const line of lines) this.stdout.write(`${JSON.stringify(line)}\n`);
  }

  exits(code: number | null): void {
    this.stdout.end();
    this.stdout.on("end", () => this.emit("close", code, code === null ? "SIGKILL" : null));
  }
}

async function all<T>(messages: AsyncIterable<T>): Promise<T[]> {
  const read: T[] = [];
  for await (const message of messages) read.push(message);
  return read;
}

describe("StreamJson", () => {
  it("writes each message to the engine's input as a line of JSON", async () => {
    const engine = new FakeEngine();
    const stream = new StreamJson(engine.asChild);

    stream.send({ type: "user", message: { role: "user", content: "hello" } });

    expect(await engine.input()).toEqual([
      { type: "user", message: { role: "user", content: "hello" } },
    ]);
  });

  it("reads the stream's messages, leaving out the protocol's own lines", async () => {
    const engine = new FakeEngine();
    const stream = new StreamJson(engine.asChild);

    engine.writes(
      { type: "system", subtype: "init" },
      { type: "keep_alive" },
      { type: "control_cancel_request", request_id: "r1" },
      { type: "assistant", message: { id: "m1", content: [] } },
    );
    engine.stdout.write("not JSON\n\n");
    engine.exits(0);

    expect(await all(stream.messages)).toEqual([
      { type: "system", subtype: "init" },
      { type: "keep_alive" },
      { type: "assistant", message: { id: "m1", content: [] } },
    ]);
  });

  it("sends a control request and resolves with the engine's answer to it", async () => {
    const engine = new FakeEngine();
    const stream = new StreamJson(engine.asChild);

    const answered = stream.request("get_context_usage", { detail: "summary" });
    const [request] = (await engine.input()) as { request_id: string }[];
    engine.writes({
      type: "control_response",
      response: { subtype: "success", request_id: request?.request_id, response: { total: 3 } },
    });

    await expect(answered).resolves.toEqual({ total: 3 });
    expect(request).toMatchObject({
      type: "control_request",
      request: { subtype: "get_context_usage", detail: "summary" },
    });
  });

  it("rejects a request the engine refuses, with its reason", async () => {
    const engine = new FakeEngine();
    const stream = new StreamJson(engine.asChild);

    const answered = stream.request("interrupt");
    const [request] = (await engine.input()) as { request_id: string }[];
    engine.writes({
      type: "control_response",
      response: { subtype: "error", request_id: request?.request_id, error: "busy" },
    });

    await expect(answered).rejects.toThrow("The engine refused a request: busy");
  });

  it("answers a request of the engine's with an error, so the session never hangs on it", async () => {
    const engine = new FakeEngine();
    const stream = new StreamJson(engine.asChild);

    engine.writes({
      type: "control_request",
      request_id: "e1",
      request: { subtype: "can_use_tool" },
    });

    expect(await engine.input()).toEqual([
      {
        type: "control_response",
        response: { subtype: "error", request_id: "e1", error: "The Office answers no requests." },
      },
    ]);
    expect(stream.messages.isOpen).toBe(true);
  });

  it("fails the stream and every waiting request when the engine exits with an error", async () => {
    const engine = new FakeEngine();
    const stream = new StreamJson(engine.asChild);
    const answered = stream.request("get_usage");

    engine.exits(1);

    await expect(answered).rejects.toThrow("the engine exited with 1");
    await expect(all(stream.messages)).rejects.toThrow("the engine exited with 1");
  });

  it("refuses a request at once after the engine ended", async () => {
    const engine = new FakeEngine();
    const stream = new StreamJson(engine.asChild);
    engine.exits(0);
    await all(stream.messages);

    await expect(stream.request("get_usage")).rejects.toThrow("the engine ended before answering");
  });
});
