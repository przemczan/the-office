import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { OfficeTool, OfficeToolCall, OfficeToolPicture } from "../../ports/office-tool.js";

/**
 * The largest picture, in bytes, an Office tool answer gives a Claude Code session. The API takes
 * an image of at most 5 MB as base64, which is 3.75 MB of bytes; 3 MB leaves a margin for the
 * answer's words and for a later engine lowering it. The live check "shows the model a picture an
 * Office tool answers with" in `agent-sdk-engine.test.ts` sends one just under it; record its run
 * here with the date and the versions when it is run on a signed-in machine.
 */
export const CLAUDE_CODE_PICTURE_LIMIT = 3 * 1024 * 1024;

/** Runs an Office tool for a session's call, its input checked against the tool's schema by MCP. */
export async function officeToolAnswer(
  officeTool: OfficeTool,
  input: Record<string, unknown>,
  call: OfficeToolCall,
): Promise<CallToolResult> {
  const result = await officeTool.run(input, call);
  const pictures = result.pictures ?? [];
  const shown = pictures.filter(
    (picture) => picture.content.byteLength <= CLAUDE_CODE_PICTURE_LIMIT,
  );
  const tooLarge = pictures.filter((picture) => !shown.includes(picture)).map(tooLargeWords);
  const answer = textAnswer([result.text, ...tooLarge].join("\n\n"), result.isError);
  return { ...answer, content: [...answer.content, ...shown.map(imageContent)] };
}

/** A text answer, which the Agent reads as a failed call when `isError`. */
export function textAnswer(text: string, isError: boolean): CallToolResult {
  return { content: [{ type: "text", text }], isError };
}

function imageContent(picture: OfficeToolPicture): CallToolResult["content"][number] {
  return {
    type: "image",
    data: Buffer.from(picture.content).toString("base64"),
    mimeType: picture.mediaType,
  };
}

function tooLargeWords({ name, content }: OfficeToolPicture): string {
  return `${name} is too large to show as a picture: it is ${megabytes(content.byteLength)}, and this engine shows one of at most ${megabytes(CLAUDE_CODE_PICTURE_LIMIT)}. Ask the user what it shows if you need to know.`;
}

function megabytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
