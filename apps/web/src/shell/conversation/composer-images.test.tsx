import type { MessageImage, Thread } from "@the-office/contracts";
import { act, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendMessage, uploadMessageImage } from "../../api/conversations.ts";
import { paste, screenshot } from "../attachments/pasted-files.fixtures.ts";
import {
  aThread,
  showComposer,
  stubObjectUrls,
  THREAD_ID,
  type ShownComposer,
} from "./composer-images.fixtures.tsx";

// Only the message box matters here: the lines around it read the service on their own.
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

let shown: ShownComposer | undefined;

beforeEach(() => {
  stubObjectUrls();
  vi.mocked(sendMessage).mockReset();
  vi.mocked(uploadMessageImage).mockReset();
  let uploads = 0;
  vi.mocked(uploadMessageImage).mockImplementation((_threadId, file) => {
    uploads += 1;
    return Promise.resolve<MessageImage>({
      attachmentId: `0000000${uploads}-0000-4000-8000-000000000000`,
      name: file.name,
      mediaType: file.type,
    });
  });
});

afterEach(() => {
  shown?.unmount();
  shown = undefined;
});

describe("images in a Thread's message box", () => {
  it("takes a pasted screenshot, uploads it at Send and sends the message with its id", async () => {
    vi.mocked(sendMessage).mockResolvedValue(aThread() as Thread);
    shown = showComposer();
    const taken = paste(shown.field(), [screenshot()]);
    expect(taken).toBe(true);
    expect(shown.thumbnails()).toEqual([expect.stringMatching(/^Pasted image .*\.png$/)]);
    shown.type("Look at this");
    await shown.send();
    expect(uploadMessageImage).toHaveBeenCalledTimes(1);
    expect(vi.mocked(uploadMessageImage).mock.calls[0]?.[0]).toBe(THREAD_ID);
    expect(sendMessage).toHaveBeenCalledWith(THREAD_ID, {
      text: "Look at this",
      images: ["00000001-0000-4000-8000-000000000000"],
    });
    expect(shown.thumbnails()).toEqual([]);
  });

  it("sends images with no words", async () => {
    vi.mocked(sendMessage).mockResolvedValue(aThread() as Thread);
    shown = showComposer();
    paste(shown.field(), [screenshot("alone.png")]);
    await shown.send();
    expect(sendMessage).toHaveBeenCalledWith(THREAD_ID, {
      text: "",
      images: ["00000001-0000-4000-8000-000000000000"],
    });
  });

  it("sends again after a refusal with the ids already uploaded, uploading nothing twice", async () => {
    vi.mocked(sendMessage)
      .mockRejectedValueOnce(new Error("The service is down."))
      .mockResolvedValueOnce(aThread() as Thread);
    shown = showComposer();
    paste(shown.field(), [screenshot("one.png"), screenshot("two.png")]);
    shown.type("Two pictures");
    await shown.send();
    expect(uploadMessageImage).toHaveBeenCalledTimes(2);
    expect(shown.page.textContent).toContain("The message wasn't sent");
    expect(shown.thumbnails()).toEqual(["one.png", "two.png"]);

    await shown.send();
    expect(uploadMessageImage).toHaveBeenCalledTimes(2);
    expect(sendMessage).toHaveBeenLastCalledWith(THREAD_ID, {
      text: "Two pictures",
      images: ["00000001-0000-4000-8000-000000000000", "00000002-0000-4000-8000-000000000000"],
    });
    expect(shown.thumbnails()).toEqual([]);
  });

  it("keeps an image pasted while the message is sent for the next message", async () => {
    const answers: ((thread: Thread) => void)[] = [];
    vi.mocked(sendMessage).mockReturnValue(new Promise((resolve) => answers.push(resolve)));
    const composer = showComposer();
    shown = composer;
    paste(composer.field(), [screenshot("sent.png")]);
    await composer.send();
    act(() => void paste(composer.field(), [screenshot("next.png")]));
    await act(async () => answers[0]?.(aThread()));
    expect(sendMessage).toHaveBeenCalledWith(THREAD_ID, {
      text: "",
      images: ["00000001-0000-4000-8000-000000000000"],
    });
    expect(composer.thumbnails()).toEqual(["next.png"]);
  });
});
