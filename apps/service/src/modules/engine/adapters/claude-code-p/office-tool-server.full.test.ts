import { describe, expect, it } from "vitest";
import { anOfficeToolCall } from "../../ports/office-tool.fixtures.js";
import { OfficeToolServer } from "./office-tool-server.js";
import { ALLOWED, noteTool, connected, result, callNote } from "./office-tool-server.fixtures.js";

describe("OfficeToolServer", () => {
  it("lists the session's Office tools, each always loaded", async () => {
    const server = await connected(
      new OfficeToolServer([noteTool("take_note").tool], anOfficeToolCall("s1"), ALLOWED),
    );

    const { tools } = (await result(server, "tools/list")) as { tools: unknown[] };

    expect(tools).toHaveLength(1);
    expect(tools).toMatchObject([{ name: "take_note", _meta: { "anthropic/alwaysLoad": true } }]);
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
