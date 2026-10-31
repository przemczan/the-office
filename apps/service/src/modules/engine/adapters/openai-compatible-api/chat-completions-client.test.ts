import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ChatCompletionsRequest } from "./chat-completions.js";
import {
  ChatCompletionsClient,
  ChatCompletionsError,
  chatCompletionsUrl,
  type ChatCompletionsEndpoint,
  type ChatCompletionsTimeouts,
  type CompletionEvent,
} from "./chat-completions-client.js";
import type { Completion } from "./completion-assembly.js";
import { FakeChatCompletionsServer, textReply } from "./fake-chat-completions-server.fixtures.js";

const REQUEST: ChatCompletionsRequest = {
  model: "coder:q4",
  messages: [
    { role: "system", content: "You are the Developer." },
    { role: "user", content: "Read the README." },
  ],
  tools: [
    {
      type: "function",
      function: {
        name: "Read",
        description: "Reads a file.",
        parameters: { type: "object", properties: { file_path: { type: "string" } } },
      },
    },
  ],
};

let server: FakeChatCompletionsServer;

beforeEach(async () => {
  server = await FakeChatCompletionsServer.start();
});

afterEach(async () => {
  await server.close();
});

function client(
  endpoint: Partial<ChatCompletionsEndpoint> = {},
  timeouts: Partial<ChatCompletionsTimeouts> = {},
): ChatCompletionsClient {
  return new ChatCompletionsClient(
    { name: "Strata", baseUrl: server.baseUrl, key: "", ...endpoint },
    timeouts,
  );
}

async function streamed(
  from: ChatCompletionsClient,
  signal = new AbortController().signal,
): Promise<{ texts: string[]; completion: Completion | undefined }> {
  const texts: string[] = [];
  let completion: Completion | undefined;
  for await (const event of from.stream(REQUEST, signal)) {
    if (event.kind === "text") texts.push(event.text);
    else completion = event.completion;
  }
  return { texts, completion };
}

describe("chatCompletionsUrl", () => {
  it("joins the path onto a base URL with or without its trailing slash", () => {
    expect(chatCompletionsUrl("http://127.0.0.1:8080/v1").href).toBe(
      "http://127.0.0.1:8080/v1/chat/completions",
    );
    expect(chatCompletionsUrl("http://127.0.0.1:8080/v1/").href).toBe(
      "http://127.0.0.1:8080/v1/chat/completions",
    );
    expect(chatCompletionsUrl("https://api.example.com").href).toBe(
      "https://api.example.com/chat/completions",
    );
  });
});

describe("ChatCompletionsClient", () => {
  it("streams the text as it comes, then the whole answer with its usage", async () => {
    server.script(textReply(["Hel", "lo", " there."], { prompt: 120, completion: 3, cached: 100 }));

    const { texts, completion } = await streamed(client());

    expect(texts).toEqual(["Hel", "lo", " there."]);
    expect(completion).toEqual({
      message: { role: "assistant", content: "Hello there." },
      finishReason: "stop",
      usage: { input: 20, output: 3, cacheRead: 100, cacheCreation: 0 },
    });
  });

  it("asks for a stream with its usage and sends the request as given, to the base URL either way", async () => {
    server.script(textReply(["Hi."]), textReply(["Hi."]));

    await streamed(client());
    await streamed(client({ baseUrl: `${server.baseUrl}/` }));

    expect(server.requests.map((request) => request.path)).toEqual([
      "/v1/chat/completions",
      "/v1/chat/completions",
    ]);
    expect(server.requests[0]?.body).toEqual({
      ...REQUEST,
      stream: true,
      stream_options: { include_usage: true },
    });
  });

  it("sends the key as a bearer token, and no authorization for an empty key", async () => {
    server.script(textReply(["Hi."]), textReply(["Hi."]));

    await streamed(client({ key: "sk-local" }));
    await streamed(client({ key: "" }));

    expect(server.requests.map((request) => request.authorization)).toEqual([
      "Bearer sk-local",
      undefined,
    ]);
  });

  it("assembles tool calls from interleaved pieces by their index, in the order of their index", async () => {
    server.script({
      kind: "reply",
      text: ["Reading both."],
      toolCalls: [
        { id: "call_1", name: "Read", arguments: ['{"file_', 'path":"README.md"', "}"] },
        { id: "call_2", name: "Grep", arguments: ['{"pattern"', ':"TODO"}'] },
      ],
      usage: { prompt: 50, completion: 20 },
    });

    const { completion } = await streamed(client());

    expect(completion).toEqual({
      message: {
        role: "assistant",
        content: "Reading both.",
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "Read", arguments: '{"file_path":"README.md"}' },
          },
          {
            id: "call_2",
            type: "function",
            function: { name: "Grep", arguments: '{"pattern":"TODO"}' },
          },
        ],
      },
      finishReason: "tool_calls",
      usage: { input: 50, output: 20, cacheRead: 0, cacheCreation: 0 },
    });
  });

  it("gives a tool call the server sent without an id one of its own", async () => {
    server.script({
      kind: "reply",
      toolCalls: [{ name: "Glob", arguments: ['{"pattern":"*.md"}'] }],
    });

    const { completion } = await streamed(client());

    expect(completion?.message.content).toBeNull();
    expect(completion?.message.tool_calls?.[0]?.id).toMatch(/^call_.+/);
  });

  it("reads usage sent with the finish reason, and none from a server that sends none", async () => {
    server.script(
      { ...textReply(["One."], { prompt: 10, completion: 2 }), usageIn: "finish-chunk" },
      textReply(["Two."]),
    );

    expect((await streamed(client())).completion?.usage).toEqual({
      input: 10,
      output: 2,
      cacheRead: 0,
      cacheCreation: 0,
    });
    expect((await streamed(client())).completion?.usage).toBeUndefined();
  });

  it("waits on a slow server as long as each piece comes within the wait between pieces", async () => {
    server.script({ kind: "reply", text: ["a", "b", "c", "d", "e"], pauseMs: 30, keepAlive: true });

    const { texts } = await streamed(client({}, { betweenPiecesMs: 100 }));

    expect(texts.join("")).toBe("abcde");
  });

  it("fails in the server's words when it answers an error status", async () => {
    server.script({
      kind: "status",
      status: 401,
      body: JSON.stringify({ error: { message: "Invalid key." } }),
    });

    const failure: unknown = await streamed(client()).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ChatCompletionsError);
    expect(failure).toMatchObject({ status: 401 });
    expect((failure as Error).message).toBe('The API endpoint "Strata" answered 401: Invalid key.');
  });

  it("fails in the server's words when its stream ends in an error", async () => {
    server.script({ kind: "reply", text: ["Half"], failWith: "The model ran out of memory." });

    await expect(streamed(client())).rejects.toThrow(
      /^The API endpoint "Strata" failed: The model ran out of memory\.$/,
    );
  });

  it("fails naming the wait when the server doesn't answer in time", async () => {
    server.script({ kind: "silence" });

    await expect(streamed(client({}, { untilAnswerMs: 50 }))).rejects.toThrow(
      'The API endpoint "Strata" sent nothing for 50 ms.',
    );
    expect(await server.requests[0]?.ended).toBe("closed-by-client");
  });

  it("fails naming the wait when the stream stalls", async () => {
    server.script({ kind: "reply", text: ["Thinking"], stall: true });

    await expect(streamed(client({}, { betweenPiecesMs: 50 }))).rejects.toThrow(
      'The API endpoint "Strata" sent nothing for 50 ms.',
    );
  });

  it("fails in words when the endpoint can't be reached", async () => {
    const closed = await FakeChatCompletionsServer.start();
    await closed.close();

    await expect(streamed(client({ baseUrl: closed.baseUrl }))).rejects.toThrow(
      /^The API endpoint "Strata" couldn't be reached: .*ECONNREFUSED/,
    );
  });

  it("stops on an abort with the signal's reason, closing the connection", async () => {
    server.script({ kind: "reply", text: ["Thinking"], stall: true });
    const controller = new AbortController();
    const events: CompletionEvent[] = [];

    const streaming = (async () => {
      for await (const event of client().stream(REQUEST, controller.signal)) {
        events.push(event);
        controller.abort();
      }
    })();

    await expect(streaming).rejects.toMatchObject({ name: "AbortError" });
    expect(events).toEqual([{ kind: "text", text: "Thinking" }]);
    expect(await server.requests[0]?.ended).toBe("closed-by-client");
  });

  it("sends nothing when the signal was aborted before", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(streamed(client(), controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(server.requests).toEqual([]);
  });

  it("closes the connection when the reader leaves the stream early", async () => {
    server.script({ kind: "reply", text: ["First"], stall: true });

    for await (const event of client().stream(REQUEST, new AbortController().signal)) {
      expect(event).toEqual({ kind: "text", text: "First" });
      break;
    }

    expect(await server.requests[0]?.ended).toBe("closed-by-client");
  });
});
