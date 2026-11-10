import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

// What stream-json.test.ts and stream-json.full.test.ts share.

/** An engine's process whose output the test writes and whose input it reads. */
export class FakeEngine extends EventEmitter {
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

export async function all<T>(messages: AsyncIterable<T>): Promise<T[]> {
  const read: T[] = [];
  for await (const message of messages) read.push(message);
  return read;
}
