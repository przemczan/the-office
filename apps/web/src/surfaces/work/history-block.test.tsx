import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { History } from "@the-office/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HistoryBlock, HistoryList } from "./history-block.tsx";
import { historyEntryWords, historySummary } from "./history-words.ts";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const TASK_ID = "00000000-0000-4000-8000-000000000041";

const HISTORY: History = [
  {
    kind: "state-change",
    at: "2026-11-20T09:00:00.000Z",
    from: null,
    to: "backlog",
    by: "the user Ann Lee",
  },
  {
    kind: "state-change",
    at: "2026-11-20T10:00:00.000Z",
    from: "ready",
    to: "planning",
    by: "the user Ann Lee",
  },
  {
    kind: "edit",
    at: "2026-11-20T11:00:00.000Z",
    field: "definition-of-done",
    by: "the person in the Role planner",
  },
];

function render(node: React.ReactNode): HTMLElement {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  const page = document.createElement("div");
  document.body.append(page);
  act(() =>
    createRoot(page).render(<QueryClientProvider client={queryClient}>{node}</QueryClientProvider>),
  );
  return page;
}

describe("a record's History", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it("words a creation, a move and an edit, with who made each", () => {
    expect(HISTORY.map(historyEntryWords)).toEqual([
      "Created in Backlog by the user Ann Lee",
      "Moved from Ready to Planning by the user Ann Lee",
      "Definition of Done edited by the person in the Role planner",
    ]);
  });

  it("folds to how many changes there are and when the last was", () => {
    expect(historySummary([])).toBe("Nothing yet");
    expect(historySummary(HISTORY, new Date("2026-11-24T12:00:00.000Z"))).toMatch(
      /^3 changes · last 20 Nov, \d\d:00$/,
    );
  });

  it("lists each line with its time, oldest first", () => {
    const page = render(<HistoryList history={HISTORY} />);

    const lines = [...page.querySelectorAll("li")];
    expect(lines).toHaveLength(3);
    expect(lines[1]?.textContent).toMatch(/^Moved from Ready to Planning by the user Ann Lee · /);
    expect(lines[1]?.querySelector("time")?.dateTime).toBe("2026-11-20T10:00:00.000Z");
  });

  it("says when nothing has changed yet", () => {
    const page = render(<HistoryList history={[]} />);

    expect(page.textContent).toBe("Nothing has changed yet.");
  });

  it("reads a Task's History from its route", async () => {
    const fetched = vi.fn<typeof fetch>(() => Promise.resolve(Response.json(HISTORY)));
    vi.stubGlobal("fetch", fetched);

    const page = render(<HistoryBlock record={{ kind: "task", id: TASK_ID }} />);
    // The answer is read and parsed over a few ticks, more of them on a busy machine.
    await act(() => vi.waitFor(() => expect(page.textContent).toContain("3 changes")));

    expect(String(fetched.mock.calls[0]?.[0])).toBe(`/api/tasks/${TASK_ID}/history`);
    expect(page.querySelector("section")?.getAttribute("aria-label")).toBe("History");
  });
});
