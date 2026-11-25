import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { documentOf, rendered } from "./markdown-text.fixtures.tsx";
import { MarkdownDocument, MarkdownText } from "./markdown-text.tsx";
import { ToastProvider } from "./toasts.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const TASK_ID = "8c7ba0c3-5174-4244-86c6-5ffcfadbebef";

/** The text mounted as the app shows it, in a router and with toasts. */
async function mounted(
  text: string,
  as: "message" | "document" = "message",
): Promise<{ readonly page: HTMLElement; readonly pathname: () => string }> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { enabled: false } } });
  const rootRoute = createRootRoute({
    component: () =>
      as === "message" ? <MarkdownText text={text} /> : <MarkdownDocument text={text} />,
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  const page = document.createElement("div");
  document.body.append(page);
  await act(async () => {
    createRoot(page).render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </QueryClientProvider>,
    );
    await router.load();
  });
  return { page, pathname: () => router.state.location.pathname };
}

function copyButton(page: HTMLElement, label: string): HTMLButtonElement {
  const button = page.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (button === null) throw new Error(`No "${label}" button.`);
  return button;
}

/** A clipboard the page can write to, as on a secure origin; jsdom offers none. */
function withClipboard(): Mock<(text: string) => Promise<void>> {
  const writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  return writeText;
}

function withCopyCommand(run: () => boolean): Mock<(command: string) => boolean> {
  const execCommand = vi.fn<(command: string) => boolean>(run);
  Object.defineProperty(document, "execCommand", { value: execCommand, configurable: true });
  return execCommand;
}

/**
 * Selects all of the Markdown view and copies it as the browser would, answering what the page put
 * on the clipboard, and whether it kept the browser's own copy.
 */
function copiedSelection(page: HTMLElement): {
  readonly data: Record<string, string>;
  readonly browsersOwn: boolean;
} {
  const view = page.querySelector(".markdown-text");
  if (view === null) throw new Error("No Markdown view.");
  const range = document.createRange();
  range.selectNodeContents(view);
  document.getSelection()?.removeAllRanges();
  document.getSelection()?.addRange(range);
  const data: Record<string, string> = {};
  const setData = vi.fn<(kind: string, value: string) => void>((kind, value) => {
    data[kind] = value;
  });
  const copy = new Event("copy", { bubbles: true, cancelable: true });
  Object.defineProperty(copy, "clipboardData", { value: { setData } });
  view.firstElementChild?.dispatchEvent(copy);
  return { data, browsersOwn: !copy.defaultPrevented };
}

function selectedTextArea(): string {
  const textArea = document.querySelector("textarea");
  return textArea ? textArea.value.slice(textArea.selectionStart, textArea.selectionEnd) : "";
}

describe("MarkdownText", () => {
  afterEach(() => {
    document.body.replaceChildren();
    Reflect.deleteProperty(navigator, "clipboard");
    Reflect.deleteProperty(document, "execCommand");
  });

  it("shows raw HTML as text, never as elements", () => {
    const page = document.createElement("div");
    page.innerHTML = rendered('<script>alert(1)</script>\n\n<img src="x" onerror="alert(1)">');
    expect(page.querySelector("script, img, [onerror]")).toBeNull();
    expect(page.textContent).toContain("<script>alert(1)</script>");
  });

  it("drops a javascript: link's target", () => {
    const html = rendered("[open](javascript:alert(1))");
    expect(html).not.toContain("javascript:");
  });

  it("copies a code block's code exactly and says so", async () => {
    const writeText = withClipboard();
    const { page } = await mounted("Send this:\n\n```\ngit log --oneline\n  -n 5\n```");

    await act(async () => copyButton(page, "Copy the code").click());

    expect(writeText).toHaveBeenCalledWith("git log --oneline\n  -n 5");
    expect(document.body.textContent).toContain("Copied.");
  });

  it("copies a quote's words, its paragraphs a blank line apart", async () => {
    const writeText = withClipboard();
    const { page } = await mounted("> First line\n> next line\n>\n> **Second** paragraph.");

    await act(async () => copyButton(page, "Copy the quote").click());

    expect(writeText).toHaveBeenCalledWith("First line\nnext line\n\nSecond paragraph.");
  });

  it("copies with the browser's copy command where it offers no clipboard, as over plain http", async () => {
    let selectedText = "";
    withCopyCommand(() => {
      selectedText = selectedTextArea();
      return true;
    });
    const { page } = await mounted("```\nnpm test\n```");

    await act(async () => copyButton(page, "Copy the code").click());

    expect(selectedText).toBe("npm test");
    expect(document.body.textContent).toContain("Copied.");
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("copies with the copy command when the clipboard refuses the text", async () => {
    withClipboard().mockRejectedValue(new Error("Document is not focused."));
    const copyCommand = withCopyCommand(() => true);
    const { page } = await mounted("```\nnpm test\n```");

    await act(async () => copyButton(page, "Copy the code").click());

    expect(copyCommand).toHaveBeenCalledWith("copy");
    expect(document.body.textContent).toContain("Copied.");
  });

  it("says the text couldn't be copied where the browser can't copy at all", async () => {
    withCopyCommand(() => false);
    const { page } = await mounted("```\nnpm test\n```");

    await act(async () => copyButton(page, "Copy the code").click());

    expect(document.body.textContent).toContain(
      "The text couldn't be copied. Select it and copy it instead.",
    );
  });

  it("has no Copy inline, where blocks are unwrapped", () => {
    expect(rendered("> quoted `code`", true)).not.toContain("<button");
  });

  it("opens another page of the app in place, and a record's link as its chip", async () => {
    const { page, pathname } = await mounted(
      `[the-office](/projects/the-office), [the Task](/tasks/${TASK_ID}) and [docs](https://example.com)`,
    );
    const appLink = page.querySelector<HTMLAnchorElement>('a[href="/projects/the-office"]');

    expect(appLink?.getAttribute("target")).toBeNull();
    expect(page.querySelector(`a.record-mention[href="/tasks/${TASK_ID}"]`)).not.toBeNull();
    expect(page.querySelector('a[href="https://example.com"]')?.getAttribute("target")).toBe(
      "_blank",
    );

    await act(async () => appLink?.click());

    expect(pathname()).toBe("/projects/the-office");
  });
});

describe("copying a selection of a message", () => {
  afterEach(() => {
    document.getSelection()?.removeAllRanges();
    document.body.replaceChildren();
  });

  it("puts it on the clipboard as Markdown, its chip as its link and without the Copy button", async () => {
    const { page } = await mounted(
      `## Plan\n\n- **Fix** [the Task](/tasks/${TASK_ID})\n- Run it\n\n\`\`\`sh\nnpm test\n\`\`\``,
    );

    const { data, browsersOwn } = copiedSelection(page);

    expect(browsersOwn).toBe(false);
    expect(data["text/plain"]).toBe(
      `## Plan\n\n- **Fix** [the Task](/tasks/${TASK_ID})\n- Run it\n\n\`\`\`sh\nnpm test\n\`\`\``,
    );
    expect(data["text/html"]).toContain("<strong>Fix</strong>");
  });

  it("leaves words with no formatting to the browser's own copy", async () => {
    const { page } = await mounted("Just words.\n\nAnd more words.");

    const { data, browsersOwn } = copiedSelection(page);

    expect(browsersOwn).toBe(true);
    expect(data).toEqual({});
  });
});

describe("MarkdownDocument", () => {
  afterEach(() => {
    document.body.replaceChildren();
    Reflect.deleteProperty(navigator, "clipboard");
    Reflect.deleteProperty(document, "execCommand");
  });

  it("shows raw HTML as text, never as elements", () => {
    const page = documentOf('<script>alert(1)</script>\n\n<img src="x" onerror="alert(1)">');
    expect(page.querySelector("script, img, [onerror]")).toBeNull();
    expect(page.textContent).toContain("<script>alert(1)</script>");
  });

  it("drops a javascript: link's target and opens others in a new tab", () => {
    const page = documentOf("[open](javascript:alert(1)) [docs](https://example.com)");
    expect(page.innerHTML).not.toContain("javascript:");
    expect(page.querySelector('a[href="https://example.com"]')?.getAttribute("target")).toBe(
      "_blank",
    );
  });

  it("gives a code block and a quote Copy", async () => {
    const writeText = withClipboard();
    const { page } = await mounted("# Notes\n\n> Keep it.\n\n```ts\nconst a = 1;\n```", "document");

    await act(async () => copyButton(page, "Copy the quote").click());
    await act(async () => copyButton(page, "Copy the code").click());

    expect(writeText.mock.calls).toEqual([["Keep it."], ["const a = 1;"]]);
  });
});
