import { describe, expect, it } from "vitest";
import { ATTACHMENT_SIZE_LIMIT } from "./attachment.js";
import { addFile, addLink, moveAttachment, removeAttachment } from "./attachment-changes.js";
import { AttachmentAdded, AttachmentMoved, AttachmentRemoved } from "./attachment-events.js";
import { AttachmentRefused } from "./attachment-refused.js";
import { THE_USER } from "./author.js";
import { aLink } from "./work.fixtures.js";

const adding = {
  owner: { kind: "idea", ideaId: "idea-1" },
  addedBy: THE_USER,
  addedAt: new Date("2026-10-25T09:05:00.000Z"),
} as const;

describe("addLink", () => {
  it("keeps the link trimmed and announces it", () => {
    const { attachment, event } = addLink(
      "attachment-1",
      { name: " CSV format notes ", url: " https://example.com/csv " },
      adding,
    );

    expect(attachment).toEqual(aLink());
    expect(event).toEqual(new AttachmentAdded(attachment));
  });

  it("names a link by its address when no name is given", () => {
    const { attachment } = addLink(
      "attachment-1",
      { name: "", url: "https://example.com/csv" },
      adding,
    );

    expect(attachment.name).toBe("https://example.com/csv");
  });

  it.each(["example.com", "ftp://example.com/file", "javascript:alert(1)"])(
    "refuses %s, which isn't a web address",
    (url) => {
      expect(() => addLink("attachment-1", { name: "Notes", url }, adding)).toThrow(
        new AttachmentRefused(["A link is a web address starting http:// or https://."]),
      );
    },
  );
});

describe("addFile", () => {
  it.each([
    { name: "plan.md", mediaType: "application/octet-stream", kind: "document" },
    { name: "Notes.MARKDOWN", mediaType: "text/markdown", kind: "document" },
    { name: "screen.png", mediaType: "image/png", kind: "image" },
    { name: "photo.jpg", mediaType: "IMAGE/JPEG", kind: "image" },
    { name: "logo.svg", mediaType: "image/svg+xml", kind: "file" },
    { name: "export.zip", mediaType: "application/zip", kind: "file" },
  ])("keeps $name ($mediaType) as a $kind", ({ name, mediaType, kind }) => {
    const { attachment, event } = addFile(
      "attachment-2",
      { name, mediaType, size: 10, text: false },
      adding,
    );

    expect(attachment).toMatchObject({ kind, name, mediaType, size: 10 });
    expect(event).toEqual(new AttachmentAdded(attachment));
  });

  it.each([
    { name: "plan.md", mediaType: "text/markdown", bytesAreText: false, text: true },
    { name: "themes.css", mediaType: "text/css", bytesAreText: true, text: true },
    { name: "logo.svg", mediaType: "image/svg+xml", bytesAreText: true, text: true },
    { name: "export.zip", mediaType: "application/zip", bytesAreText: false, text: false },
    { name: "screen.png", mediaType: "image/png", bytesAreText: true, text: false },
    { name: "manual.pdf", mediaType: "application/pdf", bytesAreText: true, text: false },
    { name: "manual.PDF", mediaType: "application/octet-stream", bytesAreText: true, text: false },
  ])(
    "keeps $name as a text file: $text, its bytes being text: $bytesAreText",
    ({ name, mediaType, bytesAreText, text }) => {
      const { attachment } = addFile(
        "attachment-2",
        { name, mediaType, size: 10, text: bytesAreText },
        adding,
      );

      expect(attachment.text).toBe(text);
    },
  );

  it("refuses a file over the size limit, or with a folder in its name, with every reason", () => {
    expect(() =>
      addFile(
        "attachment-2",
        {
          name: "../big.zip",
          mediaType: "application/zip",
          size: ATTACHMENT_SIZE_LIMIT + 1,
          text: false,
        },
        adding,
      ),
    ).toThrow(
      new AttachmentRefused([
        "A file's name can't contain / or \\.",
        "A file may be at most 50 MB.",
      ]),
    );
  });

  it("refuses a file without a name", () => {
    expect(() =>
      addFile("attachment-2", { name: " ", mediaType: "text/plain", size: 1, text: true }, adding),
    ).toThrow(new AttachmentRefused(["Give the Attachment a name."]));
  });
});

describe("moveAttachment", () => {
  it("moves an Idea's Attachment to the Task it was shaped into", () => {
    const to = { kind: "task", taskId: "task-7" } as const;

    const { attachment, event } = moveAttachment(aLink(), to);

    expect(attachment).toEqual({ ...aLink(), owner: to });
    expect(event).toBeInstanceOf(AttachmentMoved);
    expect(event).toMatchObject({ attachmentId: "attachment-1", from: aLink().owner, to });
  });
});

describe("removeAttachment", () => {
  it("announces the removal from its owner", () => {
    const event = removeAttachment(aLink());

    expect(event).toBeInstanceOf(AttachmentRemoved);
    expect(event).toMatchObject({ attachmentId: "attachment-1", owner: aLink().owner });
  });
});
