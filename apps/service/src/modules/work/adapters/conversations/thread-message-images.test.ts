import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MessageImages } from "../../../conversations/index.js";
import { OfficeToolRegistry } from "../../../engine/index.js";
import { anOfficeToolCall } from "../../../engine/index.fixtures.js";
import { AttachmentService } from "../../application/attachment-service.js";
import { TaskService } from "../../application/task-service.js";
import { ANN_LEE } from "../../domain/work.fixtures.js";
import { startWorkApplication, type WorkApplication } from "../../work-application.fixtures.js";
import { RUN_EVERY_CALL } from "../../../engine/index.fixtures.js";

let officeData: string;
let work: WorkApplication;

beforeAll(async () => {
  officeData = await mkdtemp(join(tmpdir(), "office-message-images-"));
  work = await startWorkApplication(officeData);
});

afterAll(async () => {
  await work.app.close();
  await rm(officeData, { recursive: true, force: true });
});

const ANN_LEE_REF = { userId: "00000000-0000-4000-8000-0000000005e1", name: "Ann Lee" };

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);

function aPicture(name: string) {
  return { name, mediaType: "image/png", content: PNG, addedBy: ANN_LEE_REF };
}

describe("the images of a Thread's messages", () => {
  it("are kept as image Attachments of a chat's Thread, read by read_attachment like any other", async () => {
    const images = work.app.get(MessageImages);
    const threadId = randomUUID();

    const stored = await images.store({ kind: "thread", threadId }, aPicture("screen.png"));
    const attachment = await work.app.get(AttachmentService).read(stored.attachmentId);
    const [readAttachment] = work.app
      .get(OfficeToolRegistry)
      .named(["read_attachment"], RUN_EVERY_CALL);
    const read = await readAttachment?.run(
      { attachmentId: stored.attachmentId },
      anOfficeToolCall("chat-session"),
    );

    expect(stored).toEqual({
      attachmentId: attachment.id,
      name: "screen.png",
      mediaType: "image/png",
      size: PNG.byteLength,
    });
    expect(attachment).toMatchObject({
      kind: "image",
      owner: { kind: "thread", threadId },
      addedBy: ANN_LEE,
    });
    expect(read).toEqual({
      text: `Attached to a message in Thread ${threadId}.\n\nscreen.png (image, image/png, 12 bytes).`,
      isError: false,
      pictures: [{ name: "screen.png", mediaType: "image/png", content: Buffer.from(PNG) }],
    });
  });

  it("are only the owner's own images, with their bytes until they are removed", async () => {
    const images = work.app.get(MessageImages);
    const attachments = work.app.get(AttachmentService);
    const task = await work.app
      .get(TaskService)
      .create(
        { title: "Pasted images", projectId: `project-${randomUUID()}`, priority: "normal" },
        ANN_LEE,
      );
    const owner = { kind: "task", taskId: task.id } as const;
    const image = await images.store(owner, aPicture("mock-up.png"));
    const ofAChat = await images.store(
      { kind: "thread", threadId: randomUUID() },
      aPicture("chat.png"),
    );
    const notes = await attachments.addFile(
      owner,
      {
        name: "notes.md",
        mediaType: "text/markdown",
        content: new TextEncoder().encode("# Notes"),
      },
      ANN_LEE,
    );
    const missing = randomUUID();

    const owned = await images.ownedImages(owner, [
      image.attachmentId,
      ofAChat.attachmentId,
      notes.id,
      missing,
    ]);
    const content = await images.content(image.attachmentId);
    await attachments.remove(image.attachmentId);

    expect([...owned.values()]).toEqual([image]);
    expect(content).toEqual(Buffer.from(PNG));
    await expect(images.content(image.attachmentId)).resolves.toBeUndefined();
    await expect(
      images.existing([image.attachmentId, ofAChat.attachmentId, missing]),
    ).resolves.toEqual(new Set([ofAChat.attachmentId]));
  });
});
