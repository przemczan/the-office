import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import type { Memory, MemoryNote, Role } from "@the-office/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { roleQueries } from "../../api/people.ts";
import { projectQueries } from "../../api/projects.ts";
import { taskQueries } from "../../api/work.ts";
import { ChatProvider } from "../../shell/chat/use-chat.tsx";
import { ThreadDraftsProvider } from "../../shell/conversation/thread-drafts.tsx";
import { ToastProvider } from "../../shell/toasts.tsx";
import { BY_ANN, BY_YOU, signIn } from "../../shell/user.fixtures.ts";
import { MemoryTab } from "./memory-tab.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const DEVELOPER = { key: "developer", letGoAt: null, card: { name: "Jim" } } as unknown as Role;

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

function aNote(id: string, user: MemoryNote["source"]): MemoryNote {
  return { id, text: `Note ${id}`, source: user, writtenAt: "2026-11-10T10:00:00.000Z" };
}

async function shownMemory(memory: Memory): Promise<HTMLElement> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  signIn(queryClient);
  queryClient.setQueryData(roleQueries.one("developer").queryKey, DEVELOPER);
  queryClient.setQueryData(roleQueries.memory("developer").queryKey, memory);
  queryClient.setQueryData(projectQueries.list().queryKey, []);
  queryClient.setQueryData(taskQueries.list().queryKey, []);
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
  const memoryRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/people/$roleKey/memory",
    component: MemoryTab,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([memoryRoute]),
    history: createMemoryHistory({ initialEntries: ["/people/developer/memory"] }),
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
  return page;
}

describe("MemoryTab", () => {
  it("names the user who added a note: you, or another user by name", async () => {
    const page = await shownMemory({
      inUse: true,
      notes: [
        aNote("a", { kind: "user", user: BY_YOU }),
        aNote("b", { kind: "user", user: BY_ANN }),
        aNote("c", { kind: "user", user: null }),
      ],
    });

    const sources = [...page.querySelectorAll(".memory-note-meta > span:nth-child(2)")].map(
      ({ textContent }) => textContent,
    );
    expect(sources).toEqual(["Added by you", "Added by Ann Lee", "Added by you"]);
  });
});
