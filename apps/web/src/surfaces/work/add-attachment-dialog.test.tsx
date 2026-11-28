import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Attachment, AttachmentOwner } from "@the-office/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { addFile } from "../../api/work.ts";
import { until } from "../../shell/page.fixtures.tsx";
import { ToastProvider } from "../../shell/toasts.tsx";
import { AddAttachmentDialog } from "./add-attachment-dialog.tsx";
import { paste, screenshot } from "../../shell/attachments/pasted-files.fixtures.ts";

const api = vi.hoisted(() => ({ addFile: vi.fn<typeof addFile>() }));
vi.mock("../../api/work.ts", async (original) => ({
  ...(await original<typeof import("../../api/work.ts")>()),
  addFile: api.addFile,
}));

const OWNER: AttachmentOwner = { kind: "task", taskId: "7a1c2b3a-9d8e-4f7a-8b6c-5d4e3f2a1b0c" };

let root: Root | undefined;
let closed = false;

function openAttach(): void {
  const page = document.createElement("div");
  document.body.append(page);
  act(() => {
    root = createRoot(page);
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <ToastProvider>
          <AddAttachmentDialog
            owner={OWNER}
            ownerTitle="Fix the login"
            onClose={() => {
              closed = true;
            }}
          />
        </ToastProvider>
      </QueryClientProvider>,
    );
  });
}

describe("Attach", () => {
  beforeEach(() => {
    closed = false;
    api.addFile.mockImplementation((_owner, file) =>
      Promise.resolve({ name: file.name } as Attachment),
    );
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = undefined;
    vi.clearAllMocks();
    document.body.replaceChildren();
  });

  it("says an image can be pasted, and attaches a pasted one right away", async () => {
    openAttach();
    expect(document.body.textContent).toContain("An image on the clipboard can be pasted here.");

    expect(paste(document.body, [screenshot()])).toBe(true);

    await until(() => expect(closed).toBe(true));
    expect(api.addFile).toHaveBeenCalledOnce();
    const [owner, file] = api.addFile.mock.calls[0] ?? [];
    expect(owner).toEqual(OWNER);
    expect(file?.name).toMatch(/^Pasted image \d{4}-\d{2}-\d{2} \d{2}\.\d{2}\.\d{2}\.png$/);
  });

  it("attaches nothing from a paste of text", async () => {
    openAttach();

    expect(paste(document.body, [screenshot()], "A1\tB1")).toBe(false);

    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
    expect(api.addFile).not.toHaveBeenCalled();
  });
});
