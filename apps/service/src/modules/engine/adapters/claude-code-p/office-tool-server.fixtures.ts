import { z } from "zod";
import type { OfficeTool, OfficeToolCall } from "../../ports/office-tool.js";
import type { ToolDecider } from "../office-rules/office-tool-call.js";
import { OfficeToolServer } from "./office-tool-server.js";

// What office-tool-server.test.ts and office-tool-server.full.test.ts share.

export const ALLOWED: ToolDecider = () => Promise.resolve({ allowed: true });

/** An Office tool that keeps every call it runs. */
export function noteTool(name: string): { tool: OfficeTool; calls: unknown[] } {
  const calls: unknown[] = [];
  const tool: OfficeTool = {
    name,
    area: "core",
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
export async function connected(server: OfficeToolServer): Promise<OfficeToolServer> {
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

export async function result(
  server: OfficeToolServer,
  method: string,
  params: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const answer = (await server.answer({ jsonrpc: "2.0", id: 1, method, params })) as {
    result: Record<string, unknown>;
  };
  return answer.result;
}

export const callNote = (server: OfficeToolServer, name: string) =>
  result(server, "tools/call", { name, arguments: { word: "tangerine" } });
