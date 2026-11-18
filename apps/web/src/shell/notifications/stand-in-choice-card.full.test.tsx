import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import type { NeedsYouItem, Now, StandInChoice, StandInSwitchResult } from "@the-office/contracts";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nowQueries } from "../../api/notifications.ts";
import { standInChoiceQueries } from "../../api/pipelines.ts";
import { projectQueries } from "../../api/projects.ts";
import { PROJECT_FILTER_STORAGE_KEY } from "../project-filter/project-filter-store.ts";
import { momentWords } from "../time.ts";
import { ToastProvider } from "../toasts.tsx";
import { NeedsYouFeed } from "./needs-you-feed.tsx";
import { StandInChoiceCard, StandInChoiceOnTask } from "./stand-in-choice-card.tsx";
import { useNeedsYou } from "./use-needs-you.ts";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const IMPLEMENT: StandInChoice = {
  runId: "0b5d3c1e-1f2a-4b3c-8d4e-5f6a7b8c9d0e",
  taskId: "1c6e4d2f-2a3b-4c4d-9e5f-6a7b8c9d0e1f",
  taskTitle: "Add a filter",
  projectId: "billing",
  stageKey: "implement",
  stageName: "Implement",
  engineName: "Claude Code",
  resetsAt: "2026-11-18T14:00:00.000Z",
  contextTokens: 182_000,
  askAbove: 100_000,
  standIn: { engineId: "claude-code-2", engineName: "Claude Code 2" },
  waitingSince: "2026-11-18T11:00:00.000Z",
};

const REVIEW: StandInChoice = {
  ...IMPLEMENT,
  runId: "2d7f5e3a-3b4c-4d5e-8f6a-7b8c9d0e1f2a",
  taskId: "3e8a6f4b-4c5d-4e6f-9a7b-8c9d0e1f2a3b",
  taskTitle: "Export usage",
  projectId: "search",
  stageKey: "review",
  stageName: "Review",
  standIn: null,
};

const PROJECTS = [
  { id: "billing", name: "Billing", icon: { light: null, dark: null }, mark: { label: "BI" } },
  { id: "search", name: "Search", icon: { light: null, dark: null }, mark: { label: "SE" } },
  { id: "admin", name: "Admin", icon: { light: null, dark: null }, mark: { label: "AD" } },
];

const ITEM: NeedsYouItem = {
  kind: "stand-in-choice",
  projectIds: ["billing", "search"],
  waitingSince: IMPLEMENT.waitingSince,
  count: 2,
};

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  localStorage.removeItem(PROJECT_FILTER_STORAGE_KEY);
  window.dispatchEvent(new StorageEvent("storage", { key: PROJECT_FILTER_STORAGE_KEY }));
});

/** The service: the waiting Stages as `listed` says now, and each switch's results. */
function serviceAnswering(
  listed: () => readonly StandInChoice[],
  results: (runIds: readonly string[]) => readonly StandInSwitchResult[],
): ReturnType<typeof vi.fn<typeof fetch>> {
  const fetched = vi.fn<typeof fetch>((input, init) => {
    if (input === "/api/stand-in-choices/switch" && init?.method === "POST") {
      const { runIds } = JSON.parse(String(init.body)) as { runIds: string[] };
      return Promise.resolve(Response.json({ results: results(runIds) }));
    }
    if (input === "/api/stand-in-choices") {
      return Promise.resolve(Response.json({ choices: listed() }));
    }
    return Promise.resolve(Response.json({}, { status: 404 }));
  });
  vi.stubGlobal("fetch", fetched);
  return fetched;
}

async function shown(
  choices: readonly StandInChoice[],
  view: () => ReactNode,
  needsYou: readonly NeedsYouItem[] = [],
): Promise<HTMLElement> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  queryClient.setQueryData(standInChoiceQueries.list().queryKey, [...choices]);
  queryClient.setQueryData(projectQueries.list().queryKey, PROJECTS as never);
  queryClient.setQueryData(nowQueries.now().queryKey, { needsYou } as unknown as Now);
  const router = createRouter({
    routeTree: createRootRoute({ component: view }),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  const page = document.createElement("div");
  document.body.append(page);
  await act(async () => {
    root = createRoot(page);
    root.render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </QueryClientProvider>,
    );
    await router.load();
  });
  return page;
}

function rowOf(page: HTMLElement, name: string): HTMLElement {
  const row = page.querySelector<HTMLElement>(`li[aria-label='${name}']`);
  if (!row) throw new Error(`There is no row ${name}.`);
  return row;
}

function buttonIn(place: HTMLElement, text: string): HTMLButtonElement | undefined {
  // The design system's Button holds its own style element after its words.
  return [...place.querySelectorAll("button")].find(({ textContent }) =>
    textContent.startsWith(`${text}@`),
  );
}

async function settled(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}

describe("the Stand-in choice card", () => {
  it("shows a row per Stage with its Task, context, the engine that ran out and the stand-in", async () => {
    const page = await shown([IMPLEMENT, REVIEW], () => <StandInChoiceCard />);

    const card = page.querySelector("[aria-label='Decision: switch Stages to a Stand-in Engine']");
    expect(card?.textContent).toContain("Decision: switch Stages to a Stand-in Engine");
    expect(card?.textContent).toContain(
      "Their context is over the 100,000 tokens set in Settings › Engines, so the stand-in reads it all again without a prompt cache.",
    );
    const implement = rowOf(page, "Implement · Add a filter");
    expect(implement.querySelector("a")?.getAttribute("href")).toBe(`/tasks/${IMPLEMENT.taskId}`);
    expect(implement.textContent).toContain("182k context");
    expect(implement.textContent).toContain(
      `Claude Code ran out; resets at ${momentWords(IMPLEMENT.resetsAt)}`,
    );
    expect(implement.textContent).toContain("Moves to Claude Code 2");
    expect(implement.textContent).toContain("Waits for the reset at");
    expect(buttonIn(implement, "Switch now")?.disabled).toBe(false);
    const review = rowOf(page, "Review · Export usage");
    expect(review.textContent).toContain("No Stand-in Engine has room now");
    expect(buttonIn(review, "Switch now")?.disabled).toBe(true);
    expect(buttonIn(review, "Switch now")?.title).toBe("No Stand-in Engine has room now.");
  });

  it("offers Switch all now only for two or more Stages, sending them all at once", async () => {
    const fetched = serviceAnswering(
      () => [],
      (runIds) => runIds.map((runId) => ({ runId, outcome: "no-room", words: "No room." })),
    );
    const one = await shown([IMPLEMENT], () => <StandInChoiceCard />);
    expect(buttonIn(one, "Switch all now")).toBeUndefined();
    act(() => root?.unmount());

    const two = await shown([IMPLEMENT, REVIEW], () => <StandInChoiceCard />);
    await act(async () => {
      buttonIn(two, "Switch all now")?.click();
    });

    const [url, request] = fetched.mock.calls[0] ?? [];
    expect(url).toBe("/api/stand-in-choices/switch");
    expect(request?.body).toBe(JSON.stringify({ runIds: [IMPLEMENT.runId, REVIEW.runId] }));
  });

  it("shows each switch's result beside its Stage while it is still listed", async () => {
    serviceAnswering(
      () => [IMPLEMENT, REVIEW],
      (runIds) =>
        runIds.map((runId) => ({
          runId,
          outcome: "failed",
          words: "The move failed, so the Task stays Paused on Claude Code.",
        })),
    );
    const page = await shown([IMPLEMENT, REVIEW], () => <StandInChoiceCard />);

    await act(async () => {
      buttonIn(rowOf(page, "Implement · Add a filter"), "Switch now")?.click();
    });
    await settled();

    expect(rowOf(page, "Implement · Add a filter").textContent).toContain(
      "The move failed, so the Task stays Paused on Claude Code.",
    );
    expect(rowOf(page, "Review · Export usage").textContent).toContain("Waits for the reset at");
  });

  it("drops a switched Stage's row, its result with it, once the list is read again", async () => {
    let listed: readonly StandInChoice[] = [IMPLEMENT, REVIEW];
    serviceAnswering(
      () => listed,
      (runIds) => {
        listed = [REVIEW];
        return runIds.map((runId) => ({ runId, outcome: "switched", words: "Moved." }));
      },
    );
    const page = await shown(listed, () => <StandInChoiceCard />);

    await act(async () => {
      buttonIn(rowOf(page, "Implement · Add a filter"), "Switch now")?.click();
    });
    await settled();

    expect(page.querySelector("li[aria-label='Implement · Add a filter']")).toBeNull();
    expect(page.textContent).not.toContain("Moved.");
    expect(buttonIn(page, "Switch all now")).toBeUndefined();
  });

  it("tells in a notice why a Stage left the card without going on", async () => {
    const words =
      "Its session is on Claude Code 2 now, but it couldn't go on: The Task's Project is gone. Resume the Task to go on there.";
    let listed: readonly StandInChoice[] = [IMPLEMENT, REVIEW];
    serviceAnswering(
      () => listed,
      (runIds) => {
        listed = [REVIEW];
        return runIds.map((runId) => ({ runId, outcome: "moved-not-resumed", words }));
      },
    );
    const page = await shown(listed, () => <StandInChoiceCard />);

    await act(async () => {
      buttonIn(rowOf(page, "Implement · Add a filter"), "Switch now")?.click();
    });
    await settled();

    expect(page.querySelector("li[aria-label='Implement · Add a filter']")).toBeNull();
    expect(page.textContent).toContain("Implement · Add a filter");
    expect(page.textContent).toContain(words);
  });

  it("shows on a Task's page only that Task's Stages, and nothing for a Task with none", async () => {
    const page = await shown([IMPLEMENT, REVIEW], () => (
      <StandInChoiceOnTask taskId={IMPLEMENT.taskId} />
    ));
    expect(page.querySelectorAll("li")).toHaveLength(1);
    expect(page.querySelector("li")?.getAttribute("aria-label")).toBe("Implement · Add a filter");
    expect(page.querySelector("li a")).toBeNull();
    expect(page.textContent).toContain("Its context is over");
    act(() => root?.unmount());

    const none = await shown([IMPLEMENT], () => <StandInChoiceOnTask taskId="another" />);
    expect(none.textContent).toBe("");
  });
});

function Feed(): ReactNode {
  const needsYou = useNeedsYou();
  return needsYou ? <NeedsYouFeed needsYou={needsYou} /> : null;
}

describe("the Stand-in choice in Needs you", () => {
  it("is one card for every waiting Stage", async () => {
    const page = await shown([IMPLEMENT, REVIEW], Feed, [ITEM]);

    expect(
      page.querySelectorAll("[aria-label='Decision: switch Stages to a Stand-in Engine']").length,
    ).toBeGreaterThan(0);
    expect(page.querySelectorAll("article")).toHaveLength(1);
    expect(page.querySelectorAll("li")).toHaveLength(2);
  });

  it("narrows its rows to the Projects the filter shows", async () => {
    localStorage.setItem(PROJECT_FILTER_STORAGE_KEY, JSON.stringify(["search"]));
    const page = await shown([IMPLEMENT, REVIEW], Feed, [ITEM]);
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: PROJECT_FILTER_STORAGE_KEY }));
    });

    expect([...page.querySelectorAll("li")].map((row) => row.getAttribute("aria-label"))).toEqual([
      "Review · Export usage",
    ]);
  });

  it("is left out while the filter shows none of its Projects", async () => {
    localStorage.setItem(PROJECT_FILTER_STORAGE_KEY, JSON.stringify(["admin"]));
    const page = await shown([IMPLEMENT, REVIEW], Feed, [ITEM]);
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: PROJECT_FILTER_STORAGE_KEY }));
    });

    expect(page.querySelector("article")).toBeNull();
    expect(page.textContent).toContain("Nothing needs you in these Projects.");
  });
});
