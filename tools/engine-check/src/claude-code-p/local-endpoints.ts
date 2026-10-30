import type { HookInput, HookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

const HOOK_PATH = "/hook";

export type HookAnswer = (input: HookInput) => Promise<HookJSONOutput>;

export interface EndpointRequests {
  /** Requests that carried the session's token. */
  readonly withToken: number;
  /** Requests refused for a missing or wrong token. */
  readonly refused: number;
}

/**
 * A stand-in for what the service serves the `-p` fallback on `localhost` (spec §5.4 Defaults): the
 * hook endpoint the Office rules answer, behind a token made for the session.
 */
export class LocalEndpoints {
  readonly token = randomUUID();
  private readonly counts = { withToken: 0, refused: 0 };
  private answerHook: HookAnswer | undefined;
  private readonly server: Server;

  private constructor(server: Server) {
    this.server = server;
  }

  static async start(): Promise<LocalEndpoints> {
    const server = createServer();
    const endpoints = new LocalEndpoints(server);
    server.on("request", (request, response) => {
      endpoints.handle(request, response).catch((error: unknown) => {
        if (!response.headersSent) {
          response.writeHead(500).end(String(error));
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    return endpoints;
  }

  /** Who answers the hook calls; until set, a call gets a failure, which the engine is told to count as a refusal. */
  answerHooksWith(answer: HookAnswer): void {
    this.answerHook = answer;
  }

  get hookUrl(): string {
    return `${this.origin}${HOOK_PATH}`;
  }

  get hookRequests(): EndpointRequests {
    return { ...this.counts };
  }

  async close(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  private get origin(): string {
    const { port } = this.server.address() as AddressInfo;
    return `http://127.0.0.1:${port}`;
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (new URL(request.url ?? "/", this.origin).pathname !== HOOK_PATH) {
      response.writeHead(404).end();
      return;
    }
    if (request.headers.authorization !== `Bearer ${this.token}`) {
      this.counts.refused++;
      response.writeHead(401).end();
      return;
    }
    this.counts.withToken++;
    if (this.answerHook === undefined) {
      response.writeHead(503).end();
      return;
    }
    const output = await this.answerHook((await readJson(request)) as HookInput);
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(output));
  }
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text === "" ? undefined : JSON.parse(text);
}
