import { randomUUID } from "node:crypto";
import { connect, createServer, type Server, type Socket } from "node:net";
import { join } from "node:path";
import type { Json } from "../json.ts";

/** What the CLI hands a `BeforeTool` hook on stdin. */
export interface BeforeToolInput {
  readonly session_id: string;
  readonly hook_event_name: string;
  readonly tool_name: string;
  readonly tool_input: Json;
  readonly cwd: string;
  readonly mcp_context?: { readonly server_name?: string; readonly tool_name?: string };
}

/** A hook's answer: allow, or deny with a reason the model reads. */
export type HookAnswer =
  { readonly decision: "allow" } | { readonly decision: "deny"; readonly reason: string };

export type HookDecider = (input: BeforeToolInput) => Promise<HookAnswer>;

/** An Office tool a session's stdio MCP server lists and relays here. */
export interface OfficeTool {
  readonly name: string;
  readonly description: string;
  /** The tool's JSON schema for its arguments. */
  readonly inputSchema: Json;
  run(input: Json): Promise<OfficeToolAnswer>;
}

export interface OfficeToolAnswer {
  readonly text: string;
  readonly isError?: boolean;
}

export interface ChannelHookCall {
  readonly input: BeforeToolInput;
  readonly answer: HookAnswer;
  /** When the hook call reached the check, to order it against the session's events. */
  readonly at: number;
}

export interface ChannelToolCall {
  readonly name: string;
  readonly input: Json;
  readonly at: number;
}

/** One line a relay writes: the session's token and what it asks. */
export type ChannelRequest =
  | { readonly token: string; readonly kind: "hook"; readonly input: BeforeToolInput }
  | { readonly token: string; readonly kind: "list-tools" }
  | {
      readonly token: string;
      readonly kind: "call-tool";
      readonly name: string;
      readonly input: Json;
    };

/**
 * A stand-in for the service's side of a Gemini session: the hook relay and the Office tool server,
 * both run by the CLI, reach it on a local socket (a Unix socket in the sandbox, a named pipe on
 * Windows), never a TCP port, behind a token made for the session. Each connection is one request
 * line and one answer line.
 */
export class OfficeChannel {
  readonly token = randomUUID();
  readonly address: string;
  readonly hookCalls: ChannelHookCall[] = [];
  readonly toolCalls: ChannelToolCall[] = [];
  private refusedRequests = 0;
  private decideHook: HookDecider = async () => ({ decision: "allow" });
  private tools: readonly OfficeTool[] = [];
  private readonly server: Server;

  private constructor(server: Server, address: string) {
    this.server = server;
    this.address = address;
  }

  static async start(folder: string): Promise<OfficeChannel> {
    const address =
      process.platform === "win32"
        ? `\\\\.\\pipe\\office-engine-check-${randomUUID()}`
        : join(folder, `office-${randomUUID().slice(0, 8)}.sock`);
    const server = createServer();
    const channel = new OfficeChannel(server, address);
    server.on("connection", (socket) => channel.serve(socket));
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(address, resolve);
    });
    return channel;
  }

  /** Requests refused for a missing or wrong token. */
  get refused(): number {
    return this.refusedRequests;
  }

  decideHooksWith(decide: HookDecider): void {
    this.decideHook = decide;
  }

  serveTools(tools: readonly OfficeTool[]): void {
    this.tools = tools;
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  private serve(socket: Socket): void {
    let buffered = "";
    let answered = false;
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      buffered += chunk;
      const end = buffered.indexOf("\n");
      if (answered || end === -1) {
        return;
      }
      answered = true;
      Promise.resolve(buffered.slice(0, end))
        .then((line) => this.answer(JSON.parse(line) as ChannelRequest))
        .then((answer) => socket.end(`${JSON.stringify(answer)}\n`))
        .catch((error: unknown) => socket.end(`${JSON.stringify({ error: String(error) })}\n`));
    });
    socket.on("error", () => undefined);
  }

  private async answer(request: ChannelRequest): Promise<Json> {
    if (request.token !== this.token) {
      this.refusedRequests++;
      throw new Error("Wrong session token");
    }
    switch (request.kind) {
      case "hook": {
        const at = Date.now();
        const answer = await this.decideHook(request.input);
        this.hookCalls.push({ input: request.input, answer, at });
        return answer;
      }
      case "list-tools":
        return this.tools.map(({ name, description, inputSchema }) => ({
          name,
          description,
          inputSchema,
        }));
      case "call-tool": {
        this.toolCalls.push({ name: request.name, input: request.input, at: Date.now() });
        const tool = this.tools.find((candidate) => candidate.name === request.name);
        if (tool === undefined) {
          return { text: `No Office tool ${request.name}`, isError: true };
        }
        const answer = await tool.run(request.input);
        return { text: answer.text, isError: answer.isError ?? false };
      }
    }
  }
}

/** Sends one request to a channel and reads its answer; used by the relays the CLI runs. */
export async function askChannel(address: string, request: ChannelRequest): Promise<Json> {
  return new Promise((resolve, reject) => {
    const socket = connect(address);
    let buffered = "";
    socket.setEncoding("utf8");
    socket.on("connect", () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on("data", (chunk: string) => (buffered += chunk));
    socket.on("end", () => {
      try {
        const answer = JSON.parse(buffered) as Json;
        if (
          answer !== null &&
          typeof answer === "object" &&
          !Array.isArray(answer) &&
          "error" in answer
        ) {
          reject(new Error(String(answer["error"])));
          return;
        }
        resolve(answer);
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
    socket.on("error", reject);
  });
}
