import type { Attachment } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import { namedAttachments } from "./decision-words.ts";

function anAttachment(id: string): Attachment {
  return { id, name: id, kind: "image" } as Attachment;
}

describe("namedAttachments", () => {
  it("keeps the Decision's order", () => {
    const named = namedAttachments({ attachmentIds: ["b", "a"] }, [
      anAttachment("a"),
      anAttachment("b"),
      anAttachment("c"),
    ]);
    expect(named.map(({ id }) => id)).toEqual(["b", "a"]);
  });

  it("leaves out one removed since the Decision opened", () => {
    const named = namedAttachments({ attachmentIds: ["gone", "a"] }, [anAttachment("a")]);
    expect(named.map(({ id }) => id)).toEqual(["a"]);
  });
});
