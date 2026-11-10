import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Attachment } from "@the-office/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SHOWN_TEXT_LIMIT } from "../../api/work.ts";
import { AttachmentChips } from "./attachment-chips.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

function aFile(
  name: string,
  kind: "document" | "file",
  mediaType: string,
  text: boolean,
): Attachment {
  return {
    kind,
    id: crypto.randomUUID(),
    owner: { kind: "task", taskId: crypto.randomUUID() },
    name,
    addedBy: { kind: "user" },
    addedAt: "2026-11-10T10:00:00.000Z",
    mediaType,
    size: 64,
    text,
  };
}

/** Shows the chips, every file's content served as `content`. */
function show(attachments: readonly Attachment[], content: string): void {
  vi.stubGlobal("fetch", () => Promise.resolve(new Response(content)));
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      <QueryClientProvider client={new QueryClient()}>
        <AttachmentChips attachments={attachments} />
      </QueryClientProvider>,
    ),
  );
}

/** Shows the chips, then opens the chip of `name`. */
function open(attachments: readonly Attachment[], name: string, content: string): void {
  show(attachments, content);
  act(() => chip(name)?.click());
}

function chip(name: string): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>(".attachment-open")].find(
    (element) => element.textContent === name,
  );
}

function dialog(): HTMLElement {
  const found = document.querySelector<HTMLElement>("[role='dialog']");
  if (!found) throw new Error("No window is open.");
  return found;
}

/** The open window's element of `selector`, once the file's text is in. */
async function shown(selector: string): Promise<Element> {
  return vi.waitFor(() => {
    const element = dialog().querySelector(selector);
    if (!element) throw new Error(`No ${selector} in the window yet.`);
    return element;
  });
}

describe("a text file's chip", () => {
  it("opens the document window with the file as plain text, its line numbers and Download", async () => {
    const themes = aFile("themes.css", "file", "text/css", true);

    open([themes], "themes.css", ":root {\n  --accent: red;\n}\n");

    expect((await shown(".plain-text-file-numbers")).textContent).toBe("1\n2\n3");
    expect(dialog().querySelector(".plain-text-file-lines")?.textContent).toBe(
      ":root {\n  --accent: red;\n}",
    );
    const download = [...dialog().querySelectorAll("a")].find((link) =>
      link.textContent?.includes("Download"),
    );
    expect(download?.getAttribute("download")).toBe("themes.css");
  });

  it("still renders a document as Markdown", async () => {
    open([aFile("plan.md", "document", "text/markdown", true)], "plan.md", "# The plan");

    expect((await shown("h1")).textContent).toBe("The plan");
    expect(dialog().querySelector(".plain-text-file")).toBeNull();
  });

  it("shows a text file over 1 MB up to its last whole line in the first MB, saying the rest is in the download", async () => {
    const line = `${"x".repeat(99)}\n`;
    const log = line.repeat(Math.ceil(SHOWN_TEXT_LIMIT / line.length) + 10);

    open([aFile("server.log", "file", "text/plain", true)], "server.log", log);

    const lines = (await shown(".plain-text-file-lines")).textContent ?? "";
    expect(lines.length).toBeLessThan(SHOWN_TEXT_LIMIT);
    expect(lines.endsWith("x")).toBe(true);
    expect(dialog().textContent).toContain(
      "This is the file's first 1 MB; the rest is in the download.",
    );
  });

  it("leaves a file that isn't text a download", () => {
    show([aFile("export.zip", "file", "application/zip", false)], "");

    expect(chip("export.zip")?.getAttribute("download")).toBe("export.zip");
    expect(document.querySelector("[role='dialog']")).toBeNull();
  });
});
