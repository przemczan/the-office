import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Message } from "@the-office/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { roleQueries } from "../../api/people.ts";
import { MessageList } from "./message-list.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
Element.prototype.scrollIntoView = () => undefined;

const SHOT = "11111111-1111-4111-8111-111111111111";
const LOG = "22222222-2222-4222-8222-222222222222";

function withImages(): Message {
  return {
    at: "2026-11-16T09:30:00.000Z",
    id: "1",
    kind: "user",
    text: "Here is what I see",
    delivery: "delivered",
    writtenBy: { userId: "ann", name: "Ann Lee" },
    handoverNoteFrom: null,
    openPage: null,
    images: [
      { attachmentId: SHOT, name: "screen.png", mediaType: "image/png" },
      { attachmentId: LOG, name: "log.png", mediaType: "image/png" },
    ],
  };
}

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

function show(messages: readonly Message[]): HTMLElement {
  const queryClient = new QueryClient();
  queryClient.setQueryData(roleQueries.list().queryKey, []);
  const page = document.createElement("div");
  document.body.append(page);
  root = createRoot(page);
  act(() =>
    root?.render(
      <QueryClientProvider client={queryClient}>
        <MessageList
          roleKey="developer"
          messages={messages}
          personName="Jan"
          answering={false}
          stageThread={false}
          details
        />
      </QueryClientProvider>,
    ),
  );
  return page;
}

function thumbnail(page: HTMLElement, name: string): HTMLButtonElement {
  const found = page.querySelector<HTMLButtonElement>(`[aria-label="View ${name}"]`);
  if (!found) throw new Error(`No thumbnail of ${name}.`);
  return found;
}

describe("a user message's images", () => {
  it("show as thumbnails of their content under the message", () => {
    const page = show([withImages()]);
    const shown = [...page.querySelectorAll<HTMLImageElement>(".message-images img")];
    expect(shown.map((image) => image.getAttribute("src"))).toEqual([
      `/api/attachments/${SHOT}/content`,
      `/api/attachments/${LOG}/content`,
    ]);
  });

  it("open the viewer at full size, stepping through the message's images", () => {
    const page = show([withImages()]);
    act(() => thumbnail(page, "log.png").click());
    const viewer = document.querySelector(".attachment-viewer");
    expect(viewer?.querySelector("img")?.getAttribute("src")).toBe(
      `/api/attachments/${LOG}/content`,
    );
    expect(viewer?.querySelector(".attachment-viewer-caption")?.textContent).toContain(
      "2 of 2 · Sent by Ann Lee,",
    );
  });

  it("say an image was removed in its place, never showing a broken image", () => {
    const page = show([withImages()]);
    const image = thumbnail(page, "screen.png").querySelector("img");
    act(() => void image?.dispatchEvent(new Event("error")));
    expect(page.querySelector('[aria-label="View screen.png"]')).toBeNull();
    expect(page.querySelector(".attachment-thumbnail-removed")?.textContent).toBe("Image removed");
    expect(page.querySelector('[aria-label="View log.png"]')).not.toBeNull();
  });
});
