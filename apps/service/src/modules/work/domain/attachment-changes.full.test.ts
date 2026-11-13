import { describe, expect, it } from "vitest";
import { ATTACHMENT_SIZE_LIMIT } from "./attachment.js";
import {
  addFile,
  addLink,
  attachmentToReplace,
  moveAttachment,
  removeAttachment,
  replaceFile,
} from "./attachment-changes.js";
import {
  AttachmentAdded,
  AttachmentMoved,
  AttachmentRemoved,
  AttachmentReplaced,
} from "./attachment-events.js";
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
      { name, mediaType, size: 10, text: false, sourcePath: undefined },
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
        { name, mediaType, size: 10, text: bytesAreText, sourcePath: undefined },
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
          sourcePath: undefined,
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
      addFile(
        "attachment-2",
        { name: " ", mediaType: "text/plain", size: 1, text: true, sourcePath: undefined },
        adding,
      ),
    ).toThrow(new AttachmentRefused(["Give the Attachment a name."]));
  });
});

describe("attachmentToReplace", () => {
  const owner = { kind: "task", taskId: "task-7" } as const;
  const developer = { kind: "person", roleKey: "developer" } as const;
  const agentAdding = { owner, addedBy: developer, addedAt: new Date("2026-11-13T10:00:00Z") };
  const design = addFile(
    "design",
    {
      name: "design.html",
      mediaType: "text/html",
      size: 10,
      text: true,
      sourcePath: "docs/design.html",
    },
    {
      owner,
      addedBy: { kind: "person", roleKey: "designer" },
      addedAt: new Date("2026-11-13T09:00:00Z"),
    },
  ).attachment;

  it("is the Agent's file from the same path on the Task since the last acted-on Gate", () => {
    expect(attachmentToReplace([design], agentAdding, "docs/design.html", undefined)).toBe(design);
    expect(
      attachmentToReplace(
        [design],
        agentAdding,
        "docs/design.html",
        new Date("2026-11-13T08:00:00Z"),
      ),
    ).toBe(design);
  });

  it("is none from a Gate run ending as it was added, nor from another path, Task or owner", () => {
    expect(
      attachmentToReplace([design], agentAdding, "docs/design.html", design.addedAt),
    ).toBeUndefined();
    expect(attachmentToReplace([design], agentAdding, "design.html", undefined)).toBeUndefined();
    expect(
      attachmentToReplace(
        [design],
        { ...agentAdding, owner: { kind: "task", taskId: "task-8" } },
        "docs/design.html",
        undefined,
      ),
    ).toBeUndefined();
    expect(
      attachmentToReplace(
        [{ ...design, owner: { kind: "idea", ideaId: "idea-1" } }],
        { ...agentAdding, owner: { kind: "idea", ideaId: "idea-1" } },
        "docs/design.html",
        undefined,
      ),
    ).toBeUndefined();
  });

  it("is never the user's file nor a link, and the user's upload replaces nothing", () => {
    const linked = { ...aLink({ owner }), addedBy: developer };
    expect(
      attachmentToReplace(
        [{ ...design, addedBy: THE_USER }, linked],
        agentAdding,
        "docs/design.html",
        undefined,
      ),
    ).toBeUndefined();
    expect(
      attachmentToReplace(
        [design],
        { ...agentAdding, addedBy: THE_USER },
        "docs/design.html",
        undefined,
      ),
    ).toBeUndefined();
  });
});

describe("replaceFile", () => {
  it("keeps the id, owner and place, and takes the new copy and who attached it", () => {
    const old = addFile(
      "design",
      {
        name: "design.html",
        mediaType: "text/html",
        size: 10,
        text: true,
        sourcePath: "design.html",
      },
      adding,
    ).attachment;
    const developer = { kind: "person", roleKey: "developer" } as const;

    const { attachment, event } = replaceFile(
      old,
      {
        name: "design.html",
        mediaType: "text/html",
        size: 99,
        text: false,
        sourcePath: "design.html",
      },
      developer,
    );

    expect(attachment).toEqual({ ...old, size: 99, text: false, addedBy: developer });
    expect(event).toBeInstanceOf(AttachmentReplaced);
    expect(event.attachment).toBe(attachment);
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
