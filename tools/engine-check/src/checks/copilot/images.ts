import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Check } from "../../check.ts";
import { solidPng } from "../../copilot-cli/solid-png.ts";
import { answerHolds } from "./helpers.ts";

const PROMPT =
  "Which single colour fills the attached image? Reply with just the colour's name in English. Use no tools.";

/**
 * Images on the Copilot engine: a picture the user attached reaches the model, sent as a blob (its
 * bytes in the message) and as a file attachment (a path the runtime reads).
 */
export const copilotImagesCheck: Check = {
  id: "copilot.images",
  title: "an image attached as a blob and as a file reaches the model",
  async run({ sandbox, startCopilotSession }) {
    const repository = await sandbox.createRepository();
    const png = solidPng(64, 64, { red: 255, green: 0, blue: 0 });
    const path = join(sandbox.root, "red.png");
    await writeFile(path, png);
    const session = await startCopilotSession({ repository });
    const asBlob = await session.turn(PROMPT, {
      attachments: [{ type: "blob", data: png.toString("base64"), mimeType: "image/png" }],
    });
    // A session of its own, so the answer can't come from the blob's turn.
    const fileSession = await startCopilotSession({ repository });
    const asFile = await fileSession.turn(PROMPT, {
      attachments: [{ type: "file", path, displayName: "red.png" }],
    });
    return {
      blobNamedRed: answerHolds(asBlob, "red"),
      fileNamedRed: answerHolds(asFile, "red"),
    };
  },
};
