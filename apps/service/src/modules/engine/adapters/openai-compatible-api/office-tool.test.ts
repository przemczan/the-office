import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { currentOperatingSystem } from "../../../../platform/os/current-operating-system.js";
import type { OfficeTool } from "../../ports/office-tool.js";
import { anOfficeToolCall } from "../../ports/office-tool.fixtures.js";
import { ReadFiles, type ToolContext } from "./built-in-tool.js";
import { officeBuiltInTool } from "./office-tool.js";

const CONTEXT: ToolContext = {
  folder: tmpdir(),
  environment: {},
  paths: currentOperatingSystem().paths,
  mayRead: () => true,
  readFiles: new ReadFiles(),
  callId: "call-1",
};

const SHOW_PICTURE: OfficeTool = {
  name: "show",
  description: "Shows a picture.",
  input: z.object({}),
  run: () =>
    Promise.resolve({
      text: "screen.png (image).",
      isError: false,
      pictures: [{ name: "screen.png", mediaType: "image/png", content: new Uint8Array([1]) }],
    }),
};

describe("officeBuiltInTool", () => {
  it("answers a picture in words, as this engine's tool answers are text only", async () => {
    const tool = officeBuiltInTool(SHOW_PICTURE, anOfficeToolCall("s1"), () =>
      Promise.resolve({ allowed: true }),
    );
    const call = tool.prepare({});
    if (!call.valid) throw new Error(call.problem);

    const output = await call.run(CONTEXT, new AbortController().signal);

    expect(output).toEqual({
      text: "screen.png (image).\n\nThis engine can't see pictures, so screen.png isn't shown. Ask the user what it shows if you need to know.",
      isError: false,
    });
  });
});
