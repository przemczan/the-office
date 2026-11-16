import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Attachment } from "@the-office/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { roleQueries } from "../../api/people.ts";
import { AttachmentGallery } from "./attachment-gallery.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const SCREEN: Attachment = {
  kind: "image",
  id: "11111111-1111-4111-8111-111111111111",
  owner: { kind: "task", taskId: "22222222-2222-4222-8222-222222222222" },
  name: "screen.png",
  addedBy: { kind: "person", roleKey: "developer" },
  addedAt: "2026-11-16T09:30:00.000Z",
  mediaType: "image/png",
  size: 16,
  text: false,
};

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

function show(attachments: readonly Attachment[]): HTMLElement {
  const queryClient = new QueryClient();
  queryClient.setQueryData(roleQueries.list().queryKey, []);
  const page = document.createElement("div");
  document.body.append(page);
  root = createRoot(page);
  act(() =>
    root?.render(
      <QueryClientProvider client={queryClient}>
        <AttachmentGallery
          rounds={[{ kind: "round", number: 1, sentBackWith: null, attachments }]}
        />
      </QueryClientProvider>,
    ),
  );
  return page;
}

describe("AttachmentGallery", () => {
  it("keeps an image Attachment whose picture won't load as a thumbnail that opens it, never as removed", () => {
    const page = show([SCREEN]);
    const thumbnail = page.querySelector<HTMLButtonElement>('[aria-label="View screen.png"]');
    act(() => void thumbnail?.querySelector("img")?.dispatchEvent(new Event("error")));
    expect(page.textContent).not.toContain("Image removed");

    act(() => page.querySelector<HTMLButtonElement>('[aria-label="View screen.png"]')?.click());
    const viewer = document.querySelector(".attachment-viewer");
    act(() => void viewer?.querySelector("img")?.dispatchEvent(new Event("error")));
    expect(document.body.textContent).not.toContain("Image removed");
    expect(document.body.textContent).toContain("Open the original");
  });
});
