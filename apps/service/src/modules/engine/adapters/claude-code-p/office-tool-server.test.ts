import { describe, expect, it } from "vitest";
import type { ToolDecision } from "../../domain/office-rules.js";
import { anOfficeToolCall } from "../../ports/office-tool.fixtures.js";
import type { ToolDecider } from "../office-rules/office-tool-call.js";
import { OfficeToolServer } from "./office-tool-server.js";
import { ALLOWED, noteTool, connected, callNote } from "./office-tool-server.fixtures.js";

describe("OfficeToolServer", () => {
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
});
