import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { OfficeTool, OfficeToolPicture } from "../../ports/office-tool.js";
import { anOfficeToolCall } from "../../ports/office-tool.fixtures.js";
import { CLAUDE_CODE_PICTURE_LIMIT, officeToolAnswer } from "./office-tools.js";

function pictureTool(pictures: readonly OfficeToolPicture[]): OfficeTool {
  return {
    name: "show",
    area: "core",
    description: "Shows pictures.",
    input: z.object({}),
    run: () => Promise.resolve({ text: "screen.png (image).", isError: false, pictures }),
  };
}

describe("officeToolAnswer", () => {
  it("gives a picture to the model as MCP image content after the words", async () => {
    const picture = {
      name: "screen.png",
      mediaType: "image/png",
      content: new Uint8Array([1, 2, 3]),
    };

    const answer = await officeToolAnswer(pictureTool([picture]), {}, anOfficeToolCall("s1"));

    expect(answer).toEqual({
      content: [
        { type: "text", text: "screen.png (image)." },
        { type: "image", data: "AQID", mimeType: "image/png" },
      ],
      isError: false,
    });
  });

  it("says in words that a picture over the limit is too large to show, and leaves it out", async () => {
    const large = {
      name: "poster.png",
      mediaType: "image/png",
      content: new Uint8Array(CLAUDE_CODE_PICTURE_LIMIT * 1.5),
    };

    const answer = await officeToolAnswer(pictureTool([large]), {}, anOfficeToolCall("s1"));

    expect(answer).toEqual({
      content: [
        {
          type: "text",
          text: "screen.png (image).\n\nposter.png is too large to show as a picture: it is 4.5 MB, and this engine shows one of at most 3.0 MB. Ask the user what it shows if you need to know.",
        },
      ],
      isError: false,
    });
  });
});
