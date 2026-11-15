import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import {
  PAGE_SIZE,
  type ChatThreadPage,
  type Role,
  type ThreadSummary,
} from "@the-office/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { roleQueries } from "../../api/people.ts";
import { projectQueries } from "../../api/projects.ts";
import { ChatProvider } from "../../shell/chat/use-chat.tsx";
import { ThreadDraftsProvider } from "../../shell/conversation/thread-drafts.tsx";
import { ToastProvider } from "../../shell/toasts.tsx";
import { signIn } from "../../shell/user.fixtures.ts";
import { ConversationsTab } from "./conversations-tab.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const DEVELOPER = {
  key: "developer",
  letGoAt: null,
  card: { name: "Jim", capabilities: { chat: true } },
} as unknown as Role;

/** The cursor the first page of the chat gives, for the page after it. */
const NEXT = "after-the-30th";

let root: Root | undefined;
let queryClient: QueryClient;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

/** The person's `n`th chat Thread, the newest first. */
function aChatThread(n: number): ThreadSummary {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    home: { kind: "chat", roleKey: "developer" },
    roleKey: "developer",
    title: `Thread ${n}`,
    state: "waiting",
    tokens: { input: 100, output: 200, cacheRead: 0, cacheCreation: 0 },
    startedAt: "2026-11-10T10:00:00.000Z",
    consultation: null,
    answered: false,
    lastMovedAt: "2026-11-10T10:00:00.000Z",
    context: {
      move: "resume",
      reason: "cache-warm",
      cacheWarm: true,
      cacheWarmUntil: "2026-11-10T10:05:00.000Z",
      contextTokens: 1200,
    },
  };
}

/** The service with 34 chat Threads, answered 30 and then 4, and no Threads on Tasks. */
function aService(): string[] {
  const asked: string[] = [];
  const threads = Array.from({ length: 34 }, (_, index) => aChatThread(index + 1));
  vi.stubGlobal("fetch", (input: string) => {
    asked.push(input);
    const url = new URL(input, "http://office.test");
    if (url.pathname === "/api/chats/developer/threads") {
      const page: ChatThreadPage =
        url.searchParams.get("after") === NEXT
          ? { rows: threads.slice(PAGE_SIZE), next: null, total: threads.length }
          : { rows: threads.slice(0, PAGE_SIZE), next: NEXT, total: threads.length };
      return Promise.resolve(Response.json(page));
    }
    if (url.pathname === "/api/roles/developer/task-threads") {
      return Promise.resolve(Response.json({ rows: [], next: null, total: 0 }));
    }
    return Promise.resolve(Response.json({ message: "Not here." }, { status: 404 }));
  });
  return asked;
}

/** Until nothing is being asked of the service, and what it answered is on the page. */
async function settled(): Promise<void> {
  await act(async () => {
    await vi.waitFor(() => expect(queryClient.isFetching()).toBe(0));
  });
}

async function shownConversations(): Promise<HTMLElement> {
  queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  signIn(queryClient);
  queryClient.setQueryData(roleQueries.one("developer").queryKey, DEVELOPER);
  queryClient.setQueryData(projectQueries.list().queryKey, []);
  const rootRoute = createRootRoute({
    component: () => (
      <ThreadDraftsProvider>
        <ChatProvider>
          <ToastProvider>
            <Outlet />
          </ToastProvider>
        </ChatProvider>
      </ThreadDraftsProvider>
    ),
  });
  const conversationsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/people/$roleKey/conversations",
    component: ConversationsTab,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([conversationsRoute]),
    history: createMemoryHistory({ initialEntries: ["/people/developer/conversations"] }),
  });
  const page = document.createElement("div");
  document.body.append(page);
  await act(async () => {
    root = createRoot(page);
    root.render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    await router.load();
  });
  await settled();
  return page;
}

function chatColumn(page: HTMLElement): Element {
  const column = page.querySelector(".person-column");
  if (!column) throw new Error("No chat column on the page.");
  return column;
}

function showMoreIn(column: Element): HTMLButtonElement | null {
  return column.querySelector<HTMLButtonElement>(".show-more button");
}

describe("ConversationsTab", () => {
  it("shows the chat a page at a time, its heading counting every Thread", async () => {
    const asked = aService();
    const page = await shownConversations();
    const column = chatColumn(page);

    expect(column.textContent).toContain("Chat threads · 34");
    expect(column.querySelectorAll(".person-threads > li")).toHaveLength(PAGE_SIZE);
    const showMore = showMoreIn(column);
    expect(showMore?.textContent).toContain("Show more");

    await act(async () => showMore?.click());
    await settled();

    expect(asked).toContain(`/api/chats/developer/threads?after=${NEXT}`);
    expect(column.textContent).toContain("Chat threads · 34");
    const titles = [...column.querySelectorAll(".person-thread-title")].map(
      ({ textContent }) => textContent,
    );
    expect(titles).toHaveLength(34);
    expect(titles.at(-1)).toBe("Thread 34");
    expect(showMoreIn(column)).toBeNull();
  });
});
