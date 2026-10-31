import http, { type ClientRequest, type IncomingMessage } from "node:http";
import https from "node:https";
import type { ApiEndpoint } from "../../domain/api-endpoints.js";
import {
  completionChunkSchema,
  STREAM_DONE,
  type ChatCompletionsRequest,
  type CompletionChunk,
} from "./chat-completions.js";
import { CompletionAssembly, type Completion } from "./completion-assembly.js";
import { ServerSentEvents } from "./server-sent-events.js";

/** How long the client waits on a server that sends nothing, in milliseconds. */
export interface ChatCompletionsTimeouts {
  /** From the request until the answer's first bytes: a local model reads the prompt first. */
  readonly untilAnswerMs: number;
  /** Between two pieces of a streamed answer, keep-alive comments included. */
  readonly betweenPiecesMs: number;
}

/** Generous, for a slow local server on a long prompt. */
export const DEFAULT_CHAT_COMPLETIONS_TIMEOUTS: ChatCompletionsTimeouts = {
  untilAnswerMs: 15 * 60_000,
  betweenPiecesMs: 5 * 60_000,
};

/** Text of the answer as it streams. */
export interface CompletionTextEvent {
  readonly kind: "text";
  readonly text: string;
}

/** The answer ended; its message holds the whole text and tool calls. */
export interface CompletionEndedEvent {
  readonly kind: "completed";
  readonly completion: Completion;
}

export type CompletionEvent = CompletionTextEvent | CompletionEndedEvent;

/** A request failed, in words naming the API endpoint. An abort throws the signal's reason instead. */
export class ChatCompletionsError extends Error {
  override readonly name = "ChatCompletionsError";

  constructor(
    message: string,
    /** The HTTP status the server answered, when it answered one other than success. */
    readonly status?: number,
  ) {
    super(message);
  }
}

export type ChatCompletionsEndpoint = Pick<ApiEndpoint, "name" | "baseUrl" | "key">;

/** Streamed chat completions from one API endpoint, on the OpenAI-compatible API. */
export class ChatCompletionsClient {
  private readonly timeouts: ChatCompletionsTimeouts;

  constructor(
    private readonly endpoint: ChatCompletionsEndpoint,
    timeouts: Partial<ChatCompletionsTimeouts> = {},
  ) {
    this.timeouts = { ...DEFAULT_CHAT_COMPLETIONS_TIMEOUTS, ...timeouts };
  }

  /**
   * Sends the request and yields its answer's text as it streams, then the whole answer. Leaving
   * the loop early, or aborting the signal, closes the connection, which stops the server's work.
   */
  async *stream(
    request: ChatCompletionsRequest,
    signal: AbortSignal,
  ): AsyncGenerator<CompletionEvent> {
    signal.throwIfAborted();
    const outgoing = this.send(signal);
    const watchdog = new Watchdog(outgoing, (waitedMs) =>
      this.failure(`sent nothing for ${duration(waitedMs)}`),
    );
    watchdog.wait(this.timeouts.untilAnswerMs);
    try {
      const incoming = await answerTo(outgoing, streamingBody(request));
      if (!isSuccess(incoming.statusCode)) throw await this.refusal(incoming, watchdog);
      yield* this.read(incoming, watchdog);
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      if (watchdog.failure) throw watchdog.failure;
      if (error instanceof ChatCompletionsError) throw error;
      throw this.failure(`couldn't be reached: ${messageOf(error)}`);
    } finally {
      watchdog.stop();
      outgoing.destroy();
    }
  }

  private send(signal: AbortSignal): ClientRequest {
    const url = chatCompletionsUrl(this.endpoint.baseUrl);
    const transport = url.protocol === "https:" ? https : http;
    return transport.request(url, {
      method: "POST",
      signal,
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream",
        ...(this.endpoint.key === "" ? {} : { authorization: `Bearer ${this.endpoint.key}` }),
      },
    });
  }

  private async *read(
    incoming: IncomingMessage,
    watchdog: Watchdog,
  ): AsyncGenerator<CompletionEvent> {
    incoming.setEncoding("utf8");
    const events = new ServerSentEvents();
    const assembly = new CompletionAssembly();
    for await (const piece of incoming as AsyncIterable<string>) {
      watchdog.wait(this.timeouts.betweenPiecesMs);
      for (const data of events.push(piece)) {
        if (data === STREAM_DONE) {
          yield { kind: "completed", completion: assembly.completion() };
          return;
        }
        const text = assembly.add(this.chunk(data));
        if (text !== "") yield { kind: "text", text };
      }
    }
    for (const data of events.end()) if (data !== STREAM_DONE) assembly.add(this.chunk(data));
    yield { kind: "completed", completion: assembly.completion() };
  }

  private chunk(data: string): CompletionChunk {
    const parsed = completionChunkSchema.safeParse(parseJson(data));
    if (!parsed.success) throw this.failure("sent a piece of its answer that isn't a chunk");
    if (parsed.data.error)
      throw this.failure(`failed: ${parsed.data.error.message ?? "no reason given"}`);
    return parsed.data;
  }

  private async refusal(
    incoming: IncomingMessage,
    watchdog: Watchdog,
  ): Promise<ChatCompletionsError> {
    incoming.setEncoding("utf8");
    let body = "";
    for await (const piece of incoming as AsyncIterable<string>) {
      watchdog.wait(this.timeouts.betweenPiecesMs);
      body += piece;
    }
    const status = incoming.statusCode ?? 0;
    return this.failure(`answered ${status}: ${errorMessageIn(body)}`, status);
  }

  private failure(what: string, status?: number): ChatCompletionsError {
    // The server's own words may already end the sentence.
    const sentence = /[.!?]$/.test(what) ? what : `${what}.`;
    return new ChatCompletionsError(`The API endpoint "${this.endpoint.name}" ${sentence}`, status);
  }
}

/** Where an endpoint's chat completions are, its base URL kept as typed, a trailing `/` or not. */
export function chatCompletionsUrl(baseUrl: string): URL {
  return new URL("chat/completions", baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
}

function streamingBody(request: ChatCompletionsRequest): string {
  // `include_usage` asks for the tokens in a last chunk; servers that ignore it send them earlier or never.
  return JSON.stringify({ ...request, stream: true, stream_options: { include_usage: true } });
}

function answerTo(outgoing: ClientRequest, body: string): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    outgoing.once("response", resolve);
    // Kept after the answer came: the request reports later failures too, and they reach the reader.
    outgoing.on("error", reject);
    outgoing.end(body);
  });
}

function isSuccess(status: number | undefined): boolean {
  return status !== undefined && status >= 200 && status < 300;
}

/** The server's own words in an error body: OpenAI's `{ error: { message } }` and its variants. */
function errorMessageIn(body: string): string {
  const parsed: unknown = parseJson(body);
  if (typeof parsed === "object" && parsed !== null) {
    const { error, message } = parsed as { error?: unknown; message?: unknown };
    if (typeof error === "string") return error;
    if (typeof error === "object" && error !== null) {
      const nested = (error as { message?: unknown }).message;
      if (typeof nested === "string") return nested;
    }
    if (typeof message === "string") return message;
  }
  const text = body.trim();
  return text === "" ? "no reason given" : text.slice(0, 500);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function duration(milliseconds: number): string {
  return milliseconds < 1000 ? `${milliseconds} ms` : `${Math.round(milliseconds / 1000)} s`;
}

/** Fails a request once the server has sent nothing for the wait it was last given. */
class Watchdog {
  private timer: NodeJS.Timeout | undefined;
  private failed: ChatCompletionsError | undefined;

  constructor(
    private readonly request: ClientRequest,
    private readonly describe: (waitedMs: number) => ChatCompletionsError,
  ) {}

  /** What the request failed with when the wait ran out. */
  get failure(): ChatCompletionsError | undefined {
    return this.failed;
  }

  wait(milliseconds: number): void {
    this.stop();
    this.timer = setTimeout(() => {
      this.failed = this.describe(milliseconds);
      this.request.destroy(this.failed);
    }, milliseconds);
  }

  stop(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }
}
