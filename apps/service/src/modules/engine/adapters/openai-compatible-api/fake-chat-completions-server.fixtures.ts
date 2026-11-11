import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { setTimeout as wait } from "node:timers/promises";

export interface ScriptedToolCall {
  /** Left out, the server sends none and the client makes one. */
  readonly id?: string;
  readonly name: string;
  /** The arguments' JSON in the pieces it streams in, one chunk each. */
  readonly arguments: readonly string[];
}

export interface ScriptedUsage {
  readonly prompt: number;
  readonly completion: number;
  readonly cached?: number;
}

/** A streamed answer. */
export interface ScriptedReply {
  readonly kind: "reply";
  /** The text in the pieces it streams in, one chunk each. */
  readonly text?: readonly string[];
  /** Streamed after the text, their pieces taken in turn so the calls' chunks interleave. */
  readonly toolCalls?: readonly ScriptedToolCall[];
  /** Left out, the server reports no usage, as some do. */
  readonly usage?: ScriptedUsage;
  /** In a last chunk with no choices (`stream_options.include_usage`), or with the finish reason. */
  readonly usageIn?: "last-chunk" | "finish-chunk";
  /** `stop`, or `tool_calls` with tool calls, unless given. */
  readonly finishReason?: string;
  /** Before each chunk, as a slow server. */
  readonly pauseMs?: number;
  /** A keep-alive comment before each chunk. */
  readonly keepAlive?: boolean;
  /** After the pieces, the stream sends nothing more and stays open until the client leaves. */
  readonly stall?: boolean;
  /** After the pieces, the stream ends with an error chunk in these words. */
  readonly failWith?: string;
}

/** A plain HTTP answer, as an error. */
export interface ScriptedStatus {
  readonly kind: "status";
  readonly status: number;
  readonly body: string;
}

/** No answer at all: the connection stays open until the client leaves. */
export interface ScriptedSilence {
  readonly kind: "silence";
}

/**
 * An answer made from the request it answers, as a call naming an id that only an earlier tool
 * result gave.
 */
export interface ScriptedFromRequest {
  readonly kind: "from-request";
  answer(body: unknown): ScriptedReply | ScriptedStatus | ScriptedSilence;
}

export type ScriptedAnswer = ScriptedReply | ScriptedStatus | ScriptedSilence | ScriptedFromRequest;

/** How a request's answer ended. */
export type AnswerEnd = "finished" | "closed-by-client";

export interface RecordedRequest {
  readonly method: string;
  readonly path: string;
  readonly authorization: string | undefined;
  readonly body: unknown;
  readonly ended: Promise<AnswerEnd>;
}

const MODEL = "fake-model";

/**
 * A server on the OpenAI-compatible API for tests: each request to `/v1/chat/completions` takes
 * the next scripted answer, and every request is recorded. With nothing left to answer it answers
 * 500 in words saying so.
 */
export class FakeChatCompletionsServer {
  private readonly answers: ScriptedAnswer[] = [];
  private readonly recorded: RecordedRequest[] = [];

  private constructor(
    private readonly server: Server,
    /** The base URL as a user would type it, without a trailing `/`. */
    readonly baseUrl: string,
  ) {}

  static async start(): Promise<FakeChatCompletionsServer> {
    let fake: FakeChatCompletionsServer | undefined;
    const server = createServer((request, response) => {
      void fake?.answer(request, response);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    fake = new FakeChatCompletionsServer(server, `http://127.0.0.1:${port}/v1`);
    return fake;
  }

  /** Queues answers for the requests to come, in order. */
  script(...answers: ScriptedAnswer[]): void {
    this.answers.push(...answers);
  }

  get requests(): readonly RecordedRequest[] {
    return this.recorded;
  }

  async close(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  private async answer(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const ended = new Promise<AnswerEnd>((resolve) => {
      response.once("close", () =>
        resolve(response.writableFinished ? "finished" : "closed-by-client"),
      );
    });
    const body = parseJson(await readBody(request));
    this.recorded.push({
      method: request.method ?? "",
      path: request.url ?? "",
      authorization: request.headers.authorization,
      body,
      ended,
    });
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
      respond(response, 404, { error: { message: `No route ${request.method} ${request.url}.` } });
      return;
    }
    const next = this.answers.shift();
    const answer = next?.kind === "from-request" ? next.answer(body) : next;
    if (!answer) {
      respond(response, 500, { error: { message: "The fake server has no answer scripted." } });
      return;
    }
    if (answer.kind === "status") {
      response.writeHead(answer.status, { "content-type": "application/json" }).end(answer.body);
      return;
    }
    if (answer.kind === "reply") await streamReply(answer, response);
  }
}

/** Plain text, streamed as the given pieces, then usage at the end. */
export function textReply(text: readonly string[], usage?: ScriptedUsage): ScriptedReply {
  return { kind: "reply", text, ...(usage ? { usage } : {}) };
}

async function streamReply(reply: ScriptedReply, response: ServerResponse): Promise<void> {
  response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  response.flushHeaders();
  for (const chunk of replyChunks(reply)) {
    if (reply.pauseMs) await wait(reply.pauseMs);
    if (response.destroyed) return;
    if (reply.keepAlive) response.write(": keep-alive\n\n");
    response.write(`data: ${JSON.stringify(chunk)}\n\n`);
  }
  if (reply.stall) return;
  if (reply.failWith !== undefined) {
    response.end(`data: ${JSON.stringify({ error: { message: reply.failWith } })}\n\n`);
    return;
  }
  response.end("data: [DONE]\n\n");
}

/** The reply's chunks, before the closing `[DONE]`. */
function replyChunks(reply: ScriptedReply): unknown[] {
  const toolCalls = reply.toolCalls ?? [];
  const chunks: unknown[] = (reply.text ?? []).map((text) => choiceChunk({ content: text }, null));
  chunks.push(...toolCallChunks(toolCalls));
  if (reply.stall || reply.failWith !== undefined) return chunks;
  const finishReason = reply.finishReason ?? (toolCalls.length > 0 ? "tool_calls" : "stop");
  const usage = reply.usage ? wireUsage(reply.usage) : undefined;
  const usageInLastChunk = (reply.usageIn ?? "last-chunk") === "last-chunk";
  chunks.push({
    ...choiceChunk({}, finishReason),
    ...(usage && !usageInLastChunk ? { usage } : {}),
  });
  if (usage && usageInLastChunk) chunks.push({ ...envelope(), choices: [], usage });
  return chunks;
}

function toolCallChunks(toolCalls: readonly ScriptedToolCall[]): unknown[] {
  const longest = Math.max(0, ...toolCalls.map((call) => call.arguments.length));
  const chunks: unknown[] = [];
  for (let piece = 0; piece < longest; piece += 1) {
    toolCalls.forEach((call, index) => {
      const argumentsPiece = call.arguments[piece];
      if (argumentsPiece === undefined) return;
      const opening = piece === 0;
      const delta = {
        index,
        ...(opening && call.id !== undefined ? { id: call.id } : {}),
        ...(opening ? { type: "function" } : {}),
        function: { ...(opening ? { name: call.name } : {}), arguments: argumentsPiece },
      };
      chunks.push(choiceChunk({ tool_calls: [delta] }, null));
    });
  }
  return chunks;
}

function choiceChunk(
  delta: Record<string, unknown>,
  finishReason: string | null,
): Record<string, unknown> {
  return { ...envelope(), choices: [{ index: 0, delta, finish_reason: finishReason }] };
}

function envelope(): Record<string, unknown> {
  return { id: "chatcmpl-fake", object: "chat.completion.chunk", created: 0, model: MODEL };
}

function wireUsage(usage: ScriptedUsage): Record<string, unknown> {
  return {
    prompt_tokens: usage.prompt,
    completion_tokens: usage.completion,
    total_tokens: usage.prompt + usage.completion,
    ...(usage.cached === undefined
      ? {}
      : { prompt_tokens_details: { cached_tokens: usage.cached } }),
  };
}

function respond(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
}

async function readBody(request: IncomingMessage): Promise<string> {
  request.setEncoding("utf8");
  let body = "";
  for await (const piece of request as AsyncIterable<string>) body += piece;
  return body;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
