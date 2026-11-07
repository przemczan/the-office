import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { OFFICE_INSTRUCTIONS_MAX_CHARACTERS } from "@the-office/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { officeInstructionsQuery } from "../../../api/conversations.ts";
import { PageHeadingProvider } from "../../../shell/page-heading.tsx";
import { ToastProvider } from "../../../shell/toasts.tsx";
import { OfficeInstructionsSection } from "./office-instructions-section.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const SAVED_TEXT = "Write in plain words.";

afterEach(() => {
  vi.unstubAllGlobals();
});

function sectionWith(saved: string): { page: HTMLElement; queryClient: QueryClient } {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  queryClient.setQueryData(officeInstructionsQuery().queryKey, { officeInstructions: saved });
  const page = document.createElement("div");
  act(() =>
    createRoot(page).render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <PageHeadingProvider setPageHeading={() => undefined}>
            <OfficeInstructionsSection />
          </PageHeadingProvider>
        </ToastProvider>
      </QueryClientProvider>,
    ),
  );
  return { page, queryClient };
}

function textBox(page: HTMLElement): HTMLTextAreaElement {
  const box = page.querySelector("textarea");
  if (!box) throw new Error("The page has no text box.");
  return box;
}

function button(page: HTMLElement, name: string): HTMLButtonElement {
  const found = [...page.querySelectorAll("button")].find(({ textContent }) =>
    textContent.includes(name),
  );
  if (!found) throw new Error(`The page has no ${name} button.`);
  return found;
}

function type(page: HTMLElement, text: string): void {
  const box = textBox(page);
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  act(() => {
    setValue?.call(box, text);
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Runs what changes the page and lets the answers and the query's update reach it. */
async function settled(queryClient: QueryClient, change: () => void): Promise<void> {
  await act(async () => {
    change();
    await vi.waitFor(() => expect(queryClient.isMutating()).toBe(0));
    // The query tells the page of its new data in a timer of its own, after the save has ended.
    await new Promise((resolve) => setTimeout(resolve));
  });
}

function changeElsewhere(queryClient: QueryClient): Promise<void> {
  return settled(queryClient, () =>
    queryClient.setQueryData(officeInstructionsQuery().queryKey, {
      officeInstructions: "Changed elsewhere.",
    }),
  );
}

describe("Settings › Office instructions", () => {
  it("shows the text and says who gets it and when", () => {
    const { page } = sectionWith(SAVED_TEXT);

    expect(textBox(page).value).toBe(SAVED_TEXT);
    expect(page.textContent).toContain("every person gets with their Role's instructions");
    expect(page.textContent).toContain("sessions that start after it");
  });

  it("offers Save only once the text changed", () => {
    const { page } = sectionWith(SAVED_TEXT);
    expect(button(page, "Save").disabled).toBe(true);
    expect(button(page, "Save").title).toBe("No changes to save");

    type(page, "Answer briefly.");
    expect(button(page, "Save").disabled).toBe(false);
    expect(page.textContent).toContain("Unsaved changes");

    // The service trims, so spaces around the same text are no change.
    type(page, `  ${SAVED_TEXT}\n`);
    expect(button(page, "Save").disabled).toBe(true);
  });

  it("gives the saved text back with Discard", () => {
    const { page } = sectionWith(SAVED_TEXT);
    type(page, "Answer briefly.");

    act(() => button(page, "Discard").click());

    expect(textBox(page).value).toBe(SAVED_TEXT);
    expect(button(page, "Save").disabled).toBe(true);
  });

  it("saves the text and shows what the service kept", async () => {
    const fetched = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json({ officeInstructions: "Answer briefly." })),
    );
    vi.stubGlobal("fetch", fetched);
    const { page, queryClient } = sectionWith(SAVED_TEXT);
    type(page, "  Answer briefly.  ");

    await settled(queryClient, () => button(page, "Save").click());

    const [url, request] = fetched.mock.calls[0] ?? [];
    expect(url).toBe("/api/settings/office-instructions");
    expect(request?.method).toBe("PUT");
    expect(request?.body).toBe(JSON.stringify({ officeInstructions: "  Answer briefly.  " }));
    expect(textBox(page).value).toBe("Answer briefly.");
    expect(button(page, "Save").disabled).toBe(true);
    expect(page.textContent).toContain("Office instructions saved.");
  });

  it("shows a refusal and keeps what was typed", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve(Response.json({ message: "The text is too long." }, { status: 400 })),
    );
    const { page, queryClient } = sectionWith(SAVED_TEXT);
    type(page, "Answer briefly.");

    await settled(queryClient, () => button(page, "Save").click());

    expect(page.textContent).toContain("The Office instructions weren't saved");
    expect(page.textContent).toContain("The text is too long.");
    expect(textBox(page).value).toBe("Answer briefly.");
    expect(button(page, "Save").disabled).toBe(false);
  });

  it("holds Save once the trimmed text runs over, in the same text box", () => {
    const { page } = sectionWith(SAVED_TEXT);
    const box = textBox(page);

    type(page, ` ${"x".repeat(OFFICE_INSTRUCTIONS_MAX_CHARACTERS)} `);
    expect(button(page, "Save").disabled).toBe(false);

    type(page, "x".repeat(OFFICE_INSTRUCTIONS_MAX_CHARACTERS + 2));
    expect(page.textContent).toContain("2 over the limit of 20,000 characters.");
    expect(button(page, "Save").disabled).toBe(true);
    expect(button(page, "Save").title).toBe("2 over the limit of 20,000 characters.");
    expect(textBox(page)).toBe(box);
  });

  it("takes up a change from elsewhere while nothing is typed", async () => {
    const { page, queryClient } = sectionWith(SAVED_TEXT);

    await changeElsewhere(queryClient);

    expect(textBox(page).value).toBe("Changed elsewhere.");
    expect(button(page, "Save").disabled).toBe(true);
  });

  it("keeps what is being typed through a change from elsewhere", async () => {
    const { page, queryClient } = sectionWith(SAVED_TEXT);
    type(page, "Answer briefly.");

    await changeElsewhere(queryClient);

    expect(textBox(page).value).toBe("Answer briefly.");
    expect(button(page, "Save").disabled).toBe(false);
  });
});
