import {
  MESSAGE_IMAGE_BYTES,
  SKILL_COMMAND_IMAGES_PROBLEM,
  type MessageImage,
  type Thread,
} from "@the-office/contracts";
import { act, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendMessage, uploadMessageImage } from "../../api/conversations.ts";
import { paste, screenshot } from "../attachments/pasted-files.fixtures.ts";
import {
  aFile,
  aThread,
  dragOver,
  drop,
  showComposer,
  stubObjectUrls,
  THREAD_ID,
  type ShownComposer,
} from "./composer-images.fixtures.tsx";

vi.mock("../fire-alarm/alarm-note.tsx", () => ({ AlarmNote: (): ReactNode => null }));
vi.mock("../sub-agents-and-processes/sub-agents-and-processes-line.tsx", () => ({
  SubAgentsAndProcessesLine: (): ReactNode => null,
}));
vi.mock("./context-reading.tsx", () => ({
  SessionRow: (): ReactNode => null,
  ContextReading: (): ReactNode => null,
}));
vi.mock("./context-reading-words.ts", () => ({ threadReadingLook: () => ({}) }));
vi.mock("../../api/conversations.ts", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  sendMessage: vi.fn<typeof sendMessage>(),
  uploadMessageImage: vi.fn<typeof uploadMessageImage>(),
}));

const MB = 1024 * 1024;

let shown: ShownComposer | undefined;
let objectUrls: ReturnType<typeof stubObjectUrls>;

function uploaded(file: File, index: number): MessageImage {
  return {
    attachmentId: `0000000${index}-0000-4000-8000-000000000000`,
    name: file.name,
    mediaType: file.type,
  };
}

beforeEach(() => {
  objectUrls = stubObjectUrls();
  vi.mocked(sendMessage).mockReset();
  vi.mocked(uploadMessageImage).mockReset();
});

afterEach(() => {
  shown?.unmount();
  shown = undefined;
});

function readyToSend(composer: ShownComposer): boolean {
  return !composer.sendButton().disabled;
}

describe("images in a Thread's message box", () => {
  it("leaves a paste of text to the browser, even with a picture in it", () => {
    shown = showComposer();
    expect(paste(shown.field(), [screenshot()], "A1\tB1")).toBe(false);
    expect(shown.thumbnails()).toEqual([]);
  });

  it("takes images dropped on the box, marking the box while files are dragged over it", () => {
    shown = showComposer();
    dragOver(shown.box());
    expect(shown.box().hasAttribute("data-dropping")).toBe(true);
    drop(shown.box(), [aFile("diagram.webp", "image/webp")]);
    expect(shown.box().hasAttribute("data-dropping")).toBe(false);
    expect(shown.thumbnails()).toEqual(["diagram.webp"]);
  });

  it("shows each image as a thumbnail, and removing one gives its address back", () => {
    shown = showComposer();
    paste(shown.field(), [aFile("one.png"), aFile("two.png")]);
    expect(shown.page.querySelectorAll(".pending-message-image img")).toHaveLength(2);
    const remove = shown.page.querySelector<HTMLButtonElement>('[aria-label="Remove one.png"]');
    act(() => remove?.click());
    expect(shown.thumbnails()).toEqual(["two.png"]);
    expect(objectUrls.revoked).toHaveLength(1);
    shown.unmount();
    shown = undefined;
    expect(objectUrls.revoked).toHaveLength(2);
  });

  it("refuses a file that isn't PNG, JPEG, GIF or WebP before anything uploads", async () => {
    shown = showComposer();
    paste(shown.field(), [
      aFile("notes.pdf", "application/pdf"),
      aFile("logo.svg", "image/svg+xml"),
    ]);
    shown.type("Here");
    expect(shown.problems()).toEqual([
      "notes.pdf isn't an image the message can carry: only PNG, JPEG, GIF and WebP are.",
      "logo.svg isn't an image the message can carry: only PNG, JPEG, GIF and WebP are.",
    ]);
    expect(readyToSend(shown)).toBe(false);
    await shown.send();
    expect(uploadMessageImage).not.toHaveBeenCalled();
    act(() =>
      shown?.page.querySelector<HTMLButtonElement>('[aria-label="Remove notes.pdf"]')?.click(),
    );
    act(() =>
      shown?.page.querySelector<HTMLButtonElement>('[aria-label="Remove logo.svg"]')?.click(),
    );
    expect(shown.problems()).toEqual([]);
    expect(readyToSend(shown)).toBe(true);
  });

  it("refuses an image larger than the most one image may be", () => {
    shown = showComposer();
    paste(shown.field(), [aFile("huge.png", "image/png", MESSAGE_IMAGE_BYTES + 1)]);
    shown.type("Here");
    expect(shown.problems()).toEqual(["huge.png is larger than 3 MB, the most one image may be."]);
    expect(readyToSend(shown)).toBe(false);
  });

  it("refuses more images than a message carries", () => {
    shown = showComposer();
    paste(
      shown.field(),
      Array.from({ length: 11 }, (_, index) => aFile(`shot-${index}.png`)),
    );
    shown.type("Here");
    expect(shown.problems()).toEqual(["A message carries at most 10 images."]);
    expect(readyToSend(shown)).toBe(false);
  });

  it("refuses images larger together than a message may carry", () => {
    shown = showComposer();
    paste(
      shown.field(),
      Array.from({ length: 6 }, (_, index) => aFile(`shot-${index}.png`, "image/png", 3 * MB)),
    );
    shown.type("Here");
    expect(shown.problems()).toEqual(["A message's images may be at most 15 MB together."]);
    expect(readyToSend(shown)).toBe(false);
  });

  it("refuses images with a skill command, and takes them once the text is a message", () => {
    shown = showComposer();
    paste(shown.field(), [aFile("diff.png")]);
    shown.type("/review-pr 42");
    expect(shown.problems()).toEqual([SKILL_COMMAND_IMAGES_PROBLEM]);
    expect(readyToSend(shown)).toBe(false);
    shown.type("Review this");
    expect(shown.problems()).toEqual([]);
    expect(readyToSend(shown)).toBe(true);
  });

  it("uploads on the next Send only the images a refused upload left", async () => {
    vi.mocked(uploadMessageImage)
      .mockImplementationOnce((_threadId, file) => Promise.resolve(uploaded(file, 1)))
      .mockRejectedValueOnce(new Error("Too busy."))
      .mockImplementationOnce((_threadId, file) => Promise.resolve(uploaded(file, 2)));
    vi.mocked(sendMessage).mockResolvedValue(aThread() as Thread);
    shown = showComposer();
    paste(shown.field(), [aFile("one.png"), aFile("two.png")]);
    shown.type("Both");
    await shown.send();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(shown.page.textContent).toContain("The message wasn't sent");

    await shown.send();
    expect(vi.mocked(uploadMessageImage).mock.calls.map(([, file]) => file.name)).toEqual([
      "one.png",
      "two.png",
      "two.png",
    ]);
    expect(sendMessage).toHaveBeenCalledWith(THREAD_ID, {
      text: "Both",
      images: ["00000001-0000-4000-8000-000000000000", "00000002-0000-4000-8000-000000000000"],
    });
  });
});
