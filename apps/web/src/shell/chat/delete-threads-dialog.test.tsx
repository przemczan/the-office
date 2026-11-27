import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteChatThreads } from "../../api/conversations.ts";
import { ToastProvider } from "../toasts.tsx";
import { DeleteThreadsDialog, type DoomedThread } from "./delete-threads-dialog.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../../api/conversations.ts", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  deleteChatThreads: vi.fn<typeof deleteChatThreads>(),
}));

const A = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";
const B = "7f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";

let root: Root | undefined;
let page: HTMLElement | undefined;

function thread(id: string, title: string, answering = false): DoomedThread {
  return { id, title, answering };
}

async function open(
  threads: readonly DoomedThread[],
  fromHead = false,
  onDeleted = (): void => undefined,
): Promise<void> {
  page = document.createElement("div");
  document.body.append(page);
  root = createRoot(page);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root?.render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <DeleteThreadsDialog
            roleKey="designer"
            personName="Pam"
            threads={threads}
            fromHead={fromHead}
            onClose={() => undefined}
            onDeleted={onDeleted}
          />
        </ToastProvider>
      </QueryClientProvider>,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** The words of a button: the design system's Button carries its keyframes along as text. */
function wordsOf(each: Element): string {
  return (each.textContent ?? "").split("@keyframes")[0]?.trim() ?? "";
}

function button(name: string): HTMLButtonElement {
  const found = [...document.body.querySelectorAll("button")].find(
    (each) => wordsOf(each) === name,
  );
  if (!found) throw new Error(`No button ${name}.`);
  return found;
}

beforeEach(() => {
  vi.stubGlobal("fetch", () => Promise.resolve(Response.json([])));
  vi.mocked(deleteChatThreads).mockReset();
  vi.mocked(deleteChatThreads).mockResolvedValue(undefined);
});
afterEach(() => {
  act(() => root?.unmount());
  page?.remove();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("the window before Threads are deleted", () => {
  it("names the Threads, says it is for good, and puts Delete first and Close last", async () => {
    await open([thread(A, "One"), thread(B, "Two")]);

    const text = document.body.textContent ?? "";
    expect(text).toContain("Delete 2 Threads with Pam?");
    expect(text).toContain("deleted for good. This can't be undone.");
    expect(text).toContain("their tokens in Stats");
    const names = [...document.body.querySelectorAll("footer button")].map(wordsOf);
    expect(names).toEqual(["Delete 2 Threads", "Close"]);
  });

  it("titles the open Thread's window as this Thread, and lists no more than four titles", async () => {
    await open([thread(A, "One")], true);
    expect(document.body.textContent).toContain("Delete this Thread with Pam?");
    expect(button("Delete the Thread")).toBeDefined();
    act(() => root?.unmount());
    page?.remove();

    const many = ["1", "2", "3", "4", "5", "6"].map((n) =>
      thread(`${n}0000000-0000-4000-8000-000000000000`, `T${n}`),
    );
    await open(many);
    expect(document.body.querySelectorAll(".delete-threads-titles li")).toHaveLength(5);
    expect(document.body.textContent).toContain("and 2 more");
  });

  it("says the answer is stopped first when the person answers in one", async () => {
    await open([thread(A, "One", true)]);

    expect(document.body.textContent).toContain("Pam's answer in it is stopped first.");
  });

  it("deletes the Threads in one call and says so in a toast", async () => {
    const onDeleted = vi.fn<() => void>();
    await open([thread(A, "One"), thread(B, "Two")], false, onDeleted);

    await act(async () => {
      button("Delete 2 Threads").click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(deleteChatThreads).toHaveBeenCalledWith("designer", [A, B]);
    expect(onDeleted).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain("2 Threads deleted");
  });

  it("shows the service's reason and changes nothing when it refuses", async () => {
    vi.mocked(deleteChatThreads).mockRejectedValue(new Error("Jim's call is still open."));
    const onDeleted = vi.fn<() => void>();
    await open([thread(A, "One")], false, onDeleted);

    await act(async () => {
      button("Delete the Thread").click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(document.body.textContent).toContain("The Thread wasn't deleted");
    expect(document.body.textContent).toContain("Jim's call is still open.");
    expect(onDeleted).not.toHaveBeenCalled();
  });
});
