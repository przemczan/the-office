import { describe, expect, it } from "vitest";
import { userContent } from "./user-content.js";

const screenshot = {
  attachmentId: "0c6f5d1e-3a5b-4f0e-9a52-2d2f0e1c9b10",
  name: "screen.png",
  mediaType: "image/png",
  content: new Uint8Array([1, 2, 3]),
};

describe("userContent", () => {
  it("gives a message of images alone no empty text", () => {
    expect(userContent("", [screenshot], true)).toEqual([
      { type: "image_url", image_url: { url: "data:image/png;base64,AQID" } },
    ]);
    expect(userContent("", [screenshot], false)).toBe(
      "[Image screen.png, Attachment 0c6f5d1e-3a5b-4f0e-9a52-2d2f0e1c9b10: this model can't see pictures; read_attachment gives its name and size only.]",
    );
  });
});
