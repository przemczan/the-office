import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { ToolDecision } from "../../domain/office-rules.js";
import type { OfficeTool, OfficeToolCall } from "../../ports/office-tool.js";
import { anOfficeToolCall } from "../../ports/office-tool.fixtures.js";
import type { ToolDecider } from "../office-rules/office-tool-call.js";
import { OfficeToolServer } from "./office-tool-server.js";

const ALLOWED: ToolDecider = () => Promise.resolve({ allowed: true });

/** An Office tool that keeps every call it runs. */
function noteTool(name: string): { tool: OfficeTool; calls: unknown[] } {
  const calls: unknown[] = [];
  const tool: OfficeTool = {
    name,
    description: "Takes a note.",
    input: z.object({ word: z.string() }),
    run: (input, call: OfficeToolCall) => {
      calls.push({ input, sessionId: call.sessionId, outputFolder: call.outputFolder });
      return Promise.resolve({ text: "noted", isError: false });
    },
  };
  return { tool, calls };
}

/** A server that has been through the handshake the binary opens every session with. */
async function connected(server: OfficeToolServer): Promise<OfficeToolServer> {
  await server.answer({
    jsonrpc: "2.0",
    id: 0,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "claude-code", version: "2" },
    },
  });
  await server.answer({ jsonrpc: "2.0", method: "notifications/initialized" });
  return server;
}

async function result(
  server: OfficeToolServer,
  method: string,
  params: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const answer = (await server.answer({ jsonrpc: "2.0", id: 1, method, params })) as {
    result: Record<string, unknown>;
  };
  return answer.result;
}

const callNote = (server: OfficeToolServer, name: string) =>
  result(server, "tools/call", { name, arguments: { word: "tangerine" } });

describe("OfficeToolServer", () => {
  it("lists the session's Office tools, each always loaded", async () => {
    const server = await connected(
      new OfficeToolServer([noteTool("take_note").tool], anOfficeToolCall("s1"), ALLOWED),
    );

    const { tools } = (await result(server, "tools/list")) as { tools: unknown[] };

    expect(tools).toHaveLength(1);
    expect(tools).toMatchObject([{ name: "take_note", _meta: { "anthropic/alwaysLoad": true } }]);
  });

  it("runs a call for its session and answers what the tool said", async () => {
    const notes = noteTool("take_note");
    const server = await connected(
      new OfficeToolServer([notes.tool], anOfficeToolCall("s1"), ALLOWED),
    );

    expect(await callNote(server, "take_note")).toMatchObject({
      content: [{ type: "text", text: "noted" }],
      isError: false,
    });
    expect(notes.calls).toEqual([
      {
        input: { word: "tangerine" },
        sessionId: "s1",
        outputFolder: anOfficeToolCall("s1").outputFolder,
      },
    ]);
  });

  it("asks the Office rules on every call by the engine's name, and runs no tool they refuse", async () => {
    const notes = noteTool("take_note");
    const asked: string[] = [];
    const refuse: ToolDecider = (tool) => {
      asked.push(tool);
      return Promise.resolve<ToolDecision>({ allowed: false, reason: "The fire alarm is on." });
    };
    const server = await connected(
      new OfficeToolServer([notes.tool], anOfficeToolCall("s1"), refuse),
    );

    expect(await callNote(server, "take_note")).toMatchObject({
      content: [{ type: "text", text: "The fire alarm is on." }],
      isError: true,
    });
    expect(asked).toEqual(["mcp__office__take_note"]);
    expect(notes.calls).toEqual([]);
  });

  it("answers a call to a tool the session doesn't have as a failed call", async () => {
    const server = await connected(
      new OfficeToolServer([noteTool("take_note").tool], anOfficeToolCall("s1"), ALLOWED),
    );

    expect((await callNote(server, "other_note")).isError).toBe(true);
  });

  it("answers a notification at once, as the SDK does", async () => {
    const server = new OfficeToolServer([], anOfficeToolCall("s1"), ALLOWED);

    await expect(
      server.answer({ jsonrpc: "2.0", method: "notifications/initialized" }),
    ).resolves.toEqual({ jsonrpc: "2.0", result: {}, id: 0 });
  });
});
