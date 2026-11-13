import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Attachment, WorkWebEvent } from "@the-office/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { attachmentQueries, searchQuery, workEventCacheUpdates } from "../../api/work.ts";
import { AttachmentGallery } from "./attachment-gallery.tsx";
import { oneRound } from "./attachment-rounds.ts";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const TASK_ID = crypto.randomUUID();

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

function anAttachment(name: string, kind: "document" | "image" | "file", mediaType: string) {
  return {
    kind,
    id: crypto.randomUUID(),
    owner: { kind: "task", taskId: TASK_ID },
    name,
    addedBy: { kind: "person", roleKey: "designer" },
    addedAt: "2026-11-13T10:00:00.000Z",
    mediaType,
    size: 64,
    text: kind === "document",
  } satisfies Attachment;
}

/** Shows the Task's Attachments, every file's content read as `content()` gives it now. */
function show(attachments: readonly Attachment[], content: () => string): QueryClient {
  vi.stubGlobal("fetch", () => Promise.resolve(new Response(content())));
  const queryClient = new QueryClient();
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      <QueryClientProvider client={queryClient}>
        <AttachmentGallery rounds={oneRound(attachments)} />
      </QueryClientProvider>,
    ),
  );
  return queryClient;
}

function replace(queryClient: QueryClient, attachment: Attachment): void {
  const event: WorkWebEvent = {
    type: "attachment.replaced",
    occurredAt: "2026-11-13T10:05:00.000Z",
    attachmentId: attachment.id,
    owner: { kind: "task", taskId: TASK_ID },
  };
  act(() => workEventCacheUpdates["attachment.replaced"](event, queryClient));
}

function thumbnailOf(image: Attachment): string | null | undefined {
  return document.querySelector(`[aria-label='View ${image.name}'] img`)?.getAttribute("src");
}

function openChip(name: string): void {
  const chip = [...document.querySelectorAll<HTMLElement>(".attachment-open")].find(
    (element) => element.textContent === name,
  );
  act(() => chip?.click());
}

describe("an Attachment an Agent replaced", () => {
  it("shows its new copy in the thumbnail and the viewer, and leaves the others be", () => {
    const screen = anAttachment("screen.png", "image", "image/png");
    const other = anAttachment("other.png", "image", "image/png");
    const queryClient = show([screen, other], () => "");
    act(() => document.querySelector<HTMLElement>("[aria-label='View screen.png']")?.click());

    replace(queryClient, screen);

    expect(thumbnailOf(screen)).toBe(`/api/attachments/${screen.id}/content?copy=1`);
    expect(document.querySelector(".attachment-viewer-image")?.getAttribute("src")).toBe(
      `/api/attachments/${screen.id}/content?copy=1`,
    );
    expect(thumbnailOf(other)).toBe(`/api/attachments/${other.id}/content`);
  });

  it("loads its new copy into an open HTML preview, in a new frame", () => {
    const design = anAttachment("design.html", "file", "text/html");
    const queryClient = show([design], () => "");
    openChip("design.html");
    const before = document.querySelector("iframe");

    replace(queryClient, design);
    replace(queryClient, design);

    const after = document.querySelector("iframe");
    expect(after?.getAttribute("src")).toBe(`/api/attachments/${design.id}/content?copy=2`);
    expect(after).not.toBe(before);
  });

  it("reads an open document's text again", async () => {
    const plan = anAttachment("plan.md", "document", "text/markdown");
    let content = "# First copy";
    const queryClient = show([plan], () => content);
    openChip("plan.md");
    await vi.waitFor(() => expect(document.querySelector("h1")?.textContent).toBe("First copy"));

    content = "# Second copy";
    replace(queryClient, plan);

    await vi.waitFor(() => expect(document.querySelector("h1")?.textContent).toBe("Second copy"));
  });

  it("makes the Attachments and the search stale", () => {
    const plan = anAttachment("plan.md", "document", "text/markdown");
    const queryClient = new QueryClient();
    const search = searchQuery("plan", "all").queryKey;
    const attachments = attachmentQueries.of({ kind: "task", taskId: TASK_ID }).queryKey;
    queryClient.setQueryData(search, {
      tasks: [],
      ideas: [],
      initiatives: [],
      attachments: [],
      inOtherProjects: { tasks: 0, ideas: 0, initiatives: 0, attachments: 0 },
    });
    queryClient.setQueryData(attachments, []);

    replace(queryClient, plan);

    expect(queryClient.getQueryState(search)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(attachments)?.isInvalidated).toBe(true);
  });
});
