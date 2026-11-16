import { describe, expect, it } from "vitest";
import { userMessage } from "../claude-code/stream-events.js";
import { StreamJson, type StreamMcpServer } from "./stream-json.js";
import { FakeEngine, all } from "./stream-json.fixtures.js";

function mcpMessage(requestId: string, serverName: string, message: unknown) {
  return {
    type: "control_request",
    request_id: requestId,
    request: { subtype: "mcp_message", server_name: serverName, message },
  };
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

  it("writes a message with images as its text and image blocks, on one line", async () => {
    const engine = new FakeEngine();
    const stream = new StreamJson(engine.asChild);
    const message = {
      id: "7b0c0c9e-1b1a-4c55-9d43-31f1d7a5b0aa",
      text: "look",
      images: [
        {
          attachmentId: "0c6f5d1e-3a5b-4f0e-9a52-2d2f0e1c9b10",
          name: "screen.png",
          mediaType: "image/png",
          content: new Uint8Array([1, 2, 3]),
        },
      ],
    };

    stream.send(userMessage(message, "next"));

    expect(await engine.input()).toMatchObject([
      {
        type: "user",
        message: {
          role: "user",
          content: [
            { type: "text", text: "look" },
            { type: "image", source: { type: "base64", media_type: "image/png", data: "AQID" } },
          ],
        },
        priority: "next",
      },
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

  it("answers an MCP message from the server it names, after what was sent before the answer", async () => {
    const engine = new FakeEngine();
    let answerCall: ((answer: unknown) => void) | undefined;
    const office: StreamMcpServer = {
      name: "office",
      answer: () =>
        new Promise((resolve) => {
          answerCall = resolve;
        }),
    };
    const stream = new StreamJson(engine.asChild, [office]);
    const call = { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "note" } };

    engine.writes(mcpMessage("e1", "office", call));
    await engine.input();
    stream.send({ type: "user", priority: "next" });
    answerCall?.({ jsonrpc: "2.0", id: 7, result: { echoed: call } });

    expect(await engine.input()).toEqual([
      { type: "user", priority: "next" },
      {
        type: "control_response",
        response: {
          subtype: "success",
          request_id: "e1",
          response: { mcp_response: { jsonrpc: "2.0", id: 7, result: { echoed: call } } },
        },
      },
    ]);
  });

  it("refuses an MCP message for a server it doesn't serve, or one its server fails", async () => {
    const engine = new FakeEngine();
    const failing: StreamMcpServer = {
      name: "office",
      answer: () => Promise.reject(new Error("The Office tools closed.")),
    };
    const stream = new StreamJson(engine.asChild, [failing]);
    const ping = { jsonrpc: "2.0", id: 1, method: "ping" };

    engine.writes(mcpMessage("e1", "other", ping), mcpMessage("e2", "office", ping));

    expect(await engine.input()).toEqual([
      {
        type: "control_response",
        response: {
          subtype: "error",
          request_id: "e1",
          error: "The Office answers no such request.",
        },
      },
      {
        type: "control_response",
        response: { subtype: "error", request_id: "e2", error: "The Office tools closed." },
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
