import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Thread } from "@the-office/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { vi } from "vitest";
import { roleQueries } from "../../api/people.ts";
import { HandoverNotesProvider } from "./handover-notes.tsx";
import { ThreadComposer } from "./thread-composer.tsx";
import { ThreadDraftsProvider } from "./thread-drafts.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

export const THREAD_ID = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";

/** An idle chat Thread with one skill command, "/review-pr". */
export function aThread(): Thread {
  return {
    id: THREAD_ID,
    state: "idle",
    stageThread: false,
    skillCommands: [{ name: "review-pr", description: "Review a pull request." }],
    context: {
      move: "resume",
      reason: "cache-warm",
      alternatives: [],
      override: null,
    },
  } as unknown as Thread;
}

/** jsdom makes no object URLs: these are counted, so a test sees each given back. */
export function stubObjectUrls(): { readonly made: string[]; readonly revoked: string[] } {
  const made: string[] = [];
  const revoked: string[] = [];
  URL.createObjectURL = vi.fn<typeof URL.createObjectURL>(() => {
    const url = `blob:test/${made.length + 1}`;
    made.push(url);
    return url;
  });
  URL.revokeObjectURL = vi.fn<typeof URL.revokeObjectURL>((url) => void revoked.push(url));
  return { made, revoked };
}

/** A file of `type` claiming `size` bytes, without holding them. */
export function aFile(name: string, type = "image/png", size = 1024): File {
  const file = new File([new Uint8Array(4)], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

export interface ShownComposer {
  readonly page: HTMLElement;
  readonly field: () => HTMLTextAreaElement;
  readonly box: () => HTMLElement;
  readonly type: (text: string) => void;
  readonly send: () => Promise<void>;
  readonly sendButton: () => HTMLButtonElement;
  readonly thumbnails: () => string[];
  readonly problems: () => string[];
  readonly unmount: () => void;
}

export function showComposer(thread: Thread = aThread()): ShownComposer {
  const page = document.createElement("div");
  document.body.append(page);
  const root: Root = createRoot(page);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  queryClient.setQueryData(roleQueries.list().queryKey, []);
  act(() =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <HandoverNotesProvider>
          <ThreadDraftsProvider>
            <ThreadComposer thread={thread} personName="Jan" />
          </ThreadDraftsProvider>
        </HandoverNotesProvider>
      </QueryClientProvider>,
    ),
  );
  const field = (): HTMLTextAreaElement => {
    const found = page.querySelector("textarea");
    if (!found) throw new Error("No message box.");
    return found;
  };
  const box = (): HTMLElement => {
    const found = page.querySelector<HTMLElement>(".composer");
    if (!found) throw new Error("No composer.");
    return found;
  };
  const sendButton = (): HTMLButtonElement => {
    const buttons = [...page.querySelectorAll<HTMLButtonElement>(".composer button")];
    const last = buttons.at(-1);
    if (!last) throw new Error("No send button.");
    return last;
  };
  return {
    page,
    field,
    box,
    sendButton,
    type: (text) => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      act(() => {
        setValue?.call(field(), text);
        field().dispatchEvent(new Event("input", { bubbles: true }));
      });
    },
    send: async () => {
      await act(async () => {
        sendButton().click();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    },
    thumbnails: () =>
      [...page.querySelectorAll(".pending-message-image")].map(
        (tile) => tile.getAttribute("title") ?? "",
      ),
    problems: () =>
      [...page.querySelectorAll(".pending-message-image-problems li")].map(
        (problem) => problem.textContent ?? "",
      ),
    unmount: () => {
      act(() => root.unmount());
      page.remove();
    },
  };
}

/** Drops `files` on `target`, as dragging them from the desktop does. */
export function drop(target: Element, files: readonly File[]): void {
  const dataTransfer = {
    types: ["Files"],
    files: Object.assign([...files], { item: (index: number) => files[index] ?? null }),
    dropEffect: "none",
  };
  for (const type of ["dragenter", "dragover", "drop"]) {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
    act(() => void target.dispatchEvent(event));
  }
}

/** Drags `files` over `target` without dropping them. */
export function dragOver(target: Element): void {
  const event = new Event("dragover", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", {
    value: { types: ["Files"], files: [], dropEffect: "none" },
  });
  act(() => void target.dispatchEvent(event));
}
