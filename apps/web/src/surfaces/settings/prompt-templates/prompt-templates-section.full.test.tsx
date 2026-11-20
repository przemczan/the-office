import type { QueryClient } from "@tanstack/react-query";
import type { PromptTemplate, WebEvent } from "@the-office/contracts";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { promptTemplateEventInvalidations } from "../../../api/prompt-templates.ts";
import {
  BRIEF,
  GREETING,
  shownSection,
  summaryOf,
  unmountSection,
} from "./prompt-templates-section.fixtures.tsx";
import { STORED_PROBLEMS_MARK } from "./prompt-templates-section.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const BRIEF_ADDRESS = "/settings/prompt-templates?domain=work";

afterEach(() => {
  unmountSection();
  vi.unstubAllGlobals();
});

function textBox(page: HTMLElement): HTMLTextAreaElement {
  const box = page.querySelector("textarea");
  if (!box) throw new Error("The page has no text box.");
  return box;
}

function button(within: HTMLElement, name: string): HTMLButtonElement {
  const found = [...within.querySelectorAll("button")].find(
    // A button's text is followed by its spinner's style.
    ({ textContent }) => textContent.startsWith(name),
  );
  if (!found) throw new Error(`There is no ${name} button.`);
  return found;
}

function tab(page: HTMLElement, name: string): HTMLButtonElement {
  const found = [...page.querySelectorAll<HTMLButtonElement>("[role='tab']")].find(
    ({ textContent }) => textContent.startsWith(name),
  );
  if (!found) throw new Error(`There is no ${name} tab.`);
  return found;
}

function cardHead(page: HTMLElement): string {
  return page.querySelector(".library-detail .card-head")?.textContent ?? "";
}

function type(page: HTMLElement, text: string): void {
  const box = textBox(page);
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  act(() => {
    setValue?.call(box, text);
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Runs what changes the page and lets the answers and the queries' updates reach it. */
async function settled(queryClient: QueryClient, change: () => unknown): Promise<void> {
  await act(async () => {
    await change();
    await vi.waitFor(() => {
      expect(queryClient.isMutating()).toBe(0);
      expect(queryClient.isFetching()).toBe(0);
    });
    await new Promise((resolve) => setTimeout(resolve));
  });
}

/** A service answering reads with `templates`, and `answer` for anything else. */
function serviceWith(
  templates: () => readonly PromptTemplate[],
  answer: () => Response = () => Response.json({}),
): ReturnType<typeof vi.fn<typeof fetch>> {
  const fetched = vi.fn<typeof fetch>((url, request) => {
    if (request?.method !== undefined && request.method !== "GET") {
      return Promise.resolve(answer());
    }
    const path = String(url);
    if (path === "/api/settings/prompt-templates") {
      return Promise.resolve(Response.json(templates().map(summaryOf)));
    }
    const template = templates().find(
      ({ key }) => path === `/api/settings/prompt-templates/${encodeURIComponent(key)}`,
    );
    return Promise.resolve(
      template ? Response.json(template) : Response.json({ message: "No such" }, { status: 404 }),
    );
  });
  vi.stubGlobal("fetch", fetched);
  return fetched;
}

describe("Settings › Prompt templates", () => {
  it("shows a tab per domain with its count and switches the address with the tab", async () => {
    const { page, router } = await shownSection([BRIEF, GREETING]);

    expect(
      [...page.querySelectorAll("[role='tab']")].map(({ textContent }) => textContent),
    ).toEqual(["Conversations1", "Work1"]);
    expect(tab(page, "Conversations").getAttribute("aria-selected")).toBe("true");
    expect(cardHead(page)).toContain("Greeting");

    await act(async () => {
      tab(page, "Work").click();
      await vi.waitFor(() => expect(router.state.location.search).toEqual({ domain: "work" }));
    });

    expect(tab(page, "Work").getAttribute("aria-selected")).toBe("true");
    expect(cardHead(page)).toContain("Resolve's Brief");
    expect(page.querySelector("nav[aria-label='Work Prompt templates']")).not.toBeNull();
  });

  it("opens the template the address names and marks it Customised or Default", async () => {
    const { page } = await shownSection(
      [BRIEF, GREETING],
      "/settings/prompt-templates?domain=conversations&template=conversations.greeting",
    );

    expect(cardHead(page)).toContain("Customised");
    expect(page.textContent).toContain("Saved by Ann Lee,");
    expect(page.querySelector(".pick-list-aside")?.textContent).toContain("Customised");
    expect(button(page, "Reset to default").disabled).toBe(false);

    unmountSection();
    const shown = await shownSection([BRIEF, GREETING], BRIEF_ADDRESS);
    expect(cardHead(shown.page)).toContain("Default");
    expect(shown.page.textContent).toContain("The default that ships with The Office");
    expect(button(shown.page, "Reset to default").disabled).toBe(true);
  });

  it("warns of a saved text that no longer passes the check, on the card and in the list", async () => {
    const broken: PromptTemplate = {
      ...BRIEF,
      customised: true,
      text: "Resolve {{#taskTitle}.",
      problems: [{ line: 1, column: 9, message: "Unclosed tag." }],
    };
    const { page } = await shownSection([broken], BRIEF_ADDRESS);

    expect(page.textContent).toContain(
      "The saved text no longer passes the check, so The Office uses the default until it is fixed.",
    );
    expect(page.textContent).toContain("Line 1, column 9: Unclosed tag.");
    expect(page.querySelector(`[aria-label="${STORED_PROBLEMS_MARK}"]`)).not.toBeNull();
  });

  it("saves the typed text as it is and shows the answer", async () => {
    const saved: PromptTemplate = {
      ...BRIEF,
      customised: true,
      version: 1,
      text: "  Resolve {{taskTitle}} now.\n",
      savedAt: "2026-11-10T10:00:00.000Z",
      savedBy: GREETING.savedBy,
    };
    let templates: readonly PromptTemplate[] = [BRIEF];
    const fetched = serviceWith(
      () => templates,
      () => {
        templates = [saved];
        return Response.json(saved);
      },
    );
    const { page, queryClient } = await shownSection([BRIEF], BRIEF_ADDRESS);
    type(page, "  Resolve {{taskTitle}} now.\n");
    expect(page.textContent).toContain("Unsaved changes");

    await settled(queryClient, () => button(page, "Save").click());

    const put = fetched.mock.calls.find(([, request]) => request?.method === "PUT");
    expect(put?.[0]).toBe("/api/settings/prompt-templates/work.resolve-brief");
    expect(put?.[1]?.body).toBe(JSON.stringify({ text: "  Resolve {{taskTitle}} now.\n" }));
    expect(textBox(page).value).toBe("  Resolve {{taskTitle}} now.\n");
    expect(button(page, "Save").disabled).toBe(true);
    expect(cardHead(page)).toContain("Customised");
    expect(page.textContent).toContain("Prompt template saved");
  });

  it("shows a refusal's problems where they are and keeps the typed text", async () => {
    serviceWith(
      () => [BRIEF],
      () =>
        Response.json(
          {
            statusCode: 422,
            message: "The text doesn't pass the check.",
            reasons: ["The text doesn't pass the check."],
            problems: [{ line: 1, column: 4, message: "Unknown variable taskName." }],
          },
          { status: 422 },
        ),
    );
    const { page, queryClient } = await shownSection([BRIEF], BRIEF_ADDRESS);
    type(page, "Do {{taskName}}.");

    await settled(queryClient, () => button(page, "Save").click());

    expect(page.textContent).toContain("The Prompt template wasn't saved");
    expect(page.textContent).toContain("Line 1, column 4: Unknown variable taskName.");
    expect(textBox(page).value).toBe("Do {{taskName}}.");
    expect(button(page, "Save").disabled).toBe(false);
  });

  it("asks before Reset to default, then resets and shows Default", async () => {
    const customised: PromptTemplate = {
      ...BRIEF,
      customised: true,
      version: 1,
      text: "Mine.",
      savedAt: "2026-11-10T10:00:00.000Z",
      savedBy: GREETING.savedBy,
    };
    const reset: PromptTemplate = {
      ...customised,
      customised: false,
      version: 2,
      text: BRIEF.text,
    };
    let templates: readonly PromptTemplate[] = [customised];
    const fetched = serviceWith(
      () => templates,
      () => {
        templates = [reset];
        return Response.json(reset);
      },
    );
    const { page, queryClient } = await shownSection([customised], BRIEF_ADDRESS);

    act(() => button(page, "Reset to default").click());
    const dialog = document.querySelector<HTMLElement>("[role='dialog']");
    expect(dialog?.textContent).toContain("Reset Resolve's Brief to default?");
    expect(dialog?.textContent).toContain(
      "The saved text is replaced by the default that ships with The Office.",
    );
    expect(fetched).not.toHaveBeenCalled();

    await settled(queryClient, () => dialog && button(dialog, "Reset to default").click());

    const removal = fetched.mock.calls.find(([, request]) => request?.method === "DELETE");
    expect(removal?.[0]).toBe("/api/settings/prompt-templates/work.resolve-brief");
    expect(document.querySelector("[role='dialog']")).toBeNull();
    expect(textBox(page).value).toBe(BRIEF.text);
    expect(cardHead(page)).toContain("Default");
    expect(page.textContent).toContain("Reset to default by Ann Lee,");
    expect(page.textContent).toContain("Prompt template reset to default");
  });

  it("follows a change from elsewhere while nothing is typed, and spares typed text", async () => {
    const changed: PromptTemplate = { ...BRIEF, customised: true, version: 1, text: "Changed." };
    let templates: readonly PromptTemplate[] = [BRIEF];
    serviceWith(() => templates);
    const { page, queryClient } = await shownSection([BRIEF], BRIEF_ADDRESS);
    const event = { type: "prompt-template.changed", key: BRIEF.key } as unknown as WebEvent;
    const changeElsewhere = (): Promise<void> =>
      settled(queryClient, () =>
        Promise.all(
          promptTemplateEventInvalidations["prompt-template.changed"](event).map((queryKey) =>
            queryClient.invalidateQueries({ queryKey }),
          ),
        ),
      );

    templates = [changed];
    await changeElsewhere();
    expect(textBox(page).value).toBe("Changed.");
    expect(button(page, "Save").disabled).toBe(true);

    type(page, "Typed.");
    templates = [{ ...changed, version: 2, text: "Changed again." }];
    await changeElsewhere();
    expect(textBox(page).value).toBe("Typed.");
    expect(button(page, "Save").disabled).toBe(false);
  });
});
