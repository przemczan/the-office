import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
  useLocation,
} from "@tanstack/react-router";
import type { Now, WaitingForYouItem } from "@the-office/contracts";
import { act, useCallback, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nowQueries } from "../api/notifications.ts";
import { roleQueries } from "../api/people.ts";
import { projectQueries } from "../api/projects.ts";
import { useActivityPanel } from "./activity/use-activity-panel.ts";
import { useChat, ChatProvider } from "./chat/use-chat.tsx";
import { PLANNER } from "./conversation/decision-card.fixtures.tsx";
import { NeedsYouPanel } from "./notifications/needs-you-panel.tsx";
import { useNeedsYouPanel } from "./notifications/use-needs-you-panel.ts";
import { useClosingShellPanels, usePagePanel } from "./side-panels.ts";
import { ToastProvider } from "./toasts.tsx";
import { signIn } from "./user.fixtures.ts";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PROPOSAL_ID = "1a0e7c52-3b4d-4e5f-8a6b-7c8d9e0f1a01";
const THREAD_ID = "1a0e7c52-3b4d-4e5f-8a6b-7c8d9e0f1a02";

const PROPOSAL_IN_CHAT: WaitingForYouItem = {
  kind: "proposal",
  proposalId: PROPOSAL_ID,
  threadId: THREAD_ID,
  draftedBy: "planner",
  home: { kind: "chat", roleKey: "planner" },
  projectIds: [],
  waitingSince: "2026-11-21T14:02:00.000Z",
};

let root: Root | undefined;

beforeEach(() => {
  // What the cards read besides stays loading.
  vi.stubGlobal("fetch", () => new Promise<never>(() => undefined));
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

/** Every side panel, open or closed, with a way to open each; the page's own as the conversation's drawer opens. */
function Panels(): ReactNode {
  const needsYou = useNeedsYouPanel();
  const activity = useActivityPanel();
  const chat = useChat();
  const [pagePanel, setPagePanel] = useState(false);
  const closePagePanel = useCallback(() => setPagePanel(false), []);
  usePagePanel(pagePanel, closePagePanel);
  const closeShellPanels = useClosingShellPanels();
  const search = useLocation({ select: (location) => location.searchStr });
  const open = {
    needsYou: needsYou.isOpen,
    activity: activity.isOpen,
    pagePanel,
    chat: chat.isOpen,
  };
  return (
    <>
      <button data-open="needs-you" onClick={needsYou.open} />
      <button data-open="activity" onClick={activity.open} />
      <button
        data-open="page-panel"
        onClick={() => {
          closeShellPanels();
          setPagePanel(true);
        }}
      />
      <button data-open="chat" onClick={() => chat.open("planner")} />
      <output data-testid="open">
        {Object.entries(open)
          .filter(([, isOpen]) => isOpen)
          .map(([name]) => name)
          .join(" ")}
      </output>
      <output data-testid="search">{search}</output>
    </>
  );
}

async function shown(address: string): Promise<void> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  signIn(queryClient);
  queryClient.setQueryData(roleQueries.list().queryKey, [PLANNER]);
  queryClient.setQueryData(projectQueries.list().queryKey, []);
  queryClient.setQueryData(nowQueries.now().queryKey, {
    needsYou: [],
    waitingForYou: [PROPOSAL_IN_CHAT],
  } as unknown as Now);
  const router = createRouter({
    routeTree: createRootRoute({
      validateSearch: (search: Record<string, unknown>) => ({
        ...(typeof search["chat"] === "string" && { chat: search["chat"] }),
        ...(search["needsYou"] === true && { needsYou: true as const }),
        ...(search["activity"] === true && { activity: true as const }),
      }),
      component: () => (
        <ChatProvider>
          <Panels />
          <NeedsYouPanel />
        </ChatProvider>
      ),
    }),
    history: createMemoryHistory({ initialEntries: [address] }),
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
}

async function press(element: HTMLElement | null): Promise<void> {
  if (element === null) throw new Error("Nothing to press");
  await act(async () => {
    element.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function opening(panel: string): Promise<void> {
  await press(document.querySelector<HTMLElement>(`[data-open='${panel}']`));
}

function openPanels(): string | null | undefined {
  return document.querySelector("[data-testid='open']")?.textContent;
}

describe("one side panel open at a time", () => {
  it("opening a chat Proposal from Needs you leaves only the chat open", async () => {
    await shown("/?needsYou=true");
    expect(openPanels()).toBe("needsYou");

    await press(
      document.querySelector<HTMLElement>("[aria-label='Proposal: Drafted by Angela'] button"),
    );

    expect(openPanels()).toBe("chat");
    expect(document.querySelector("[aria-label='Proposal: Drafted by Angela']")).toBeNull();
    expect(document.querySelector("[data-testid='search']")?.textContent).toBe("");
  });

  it("closes the others as Needs you, Activity or the page's own panel opens", async () => {
    await shown("/");

    await opening("needs-you");
    expect(openPanels()).toBe("needsYou");
    await opening("activity");
    expect(openPanels()).toBe("activity");
    await opening("page-panel");
    expect(openPanels()).toBe("pagePanel");
    await opening("needs-you");
    expect(openPanels()).toBe("needsYou");
  });

  it("leaves the chat open under a panel opening over it", async () => {
    await shown("/");
    await opening("chat");

    await opening("activity");
    expect(openPanels()).toBe("activity chat");
    await opening("page-panel");
    expect(openPanels()).toBe("pagePanel chat");
  });

  it("closes the page's own panel as the chat opens", async () => {
    await shown("/");
    await opening("page-panel");

    await opening("chat");

    expect(openPanels()).toBe("chat");
  });

  it("opens a chat from the address with the panel it names closed, in one move", async () => {
    await shown("/?chat=planner&activity=true");

    expect(openPanels()).toBe("chat");
    expect(document.querySelector("[data-testid='search']")?.textContent).toBe("");
  });
});
