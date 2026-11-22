import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import type { Now, Project, Task, WaitingForYouItem } from "@the-office/contracts";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nowQueries } from "../../api/notifications.ts";
import { roleQueries } from "../../api/people.ts";
import { projectQueries } from "../../api/projects.ts";
import { taskQueries } from "../../api/work.ts";
import { ChatProvider, useChat } from "../chat/use-chat.tsx";
import { PLANNER, REVIEWER } from "../conversation/decision-card.fixtures.tsx";
import { PROJECT_FILTER_STORAGE_KEY } from "../project-filter/project-filter-store.ts";
import { ToastProvider } from "../toasts.tsx";
import { signIn } from "../user.fixtures.ts";
import { useWaitingForYou } from "./use-waiting-for-you.ts";
import { WaitingForYouGroup } from "./waiting-for-you-feed.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PROJECTS = [
  {
    id: "billing",
    name: "Billing",
    icon: { light: null, dark: null },
    mark: { label: "BI", colour: "teal" },
  },
  {
    id: "search",
    name: "Search",
    icon: { light: null, dark: null },
    mark: { label: "SE", colour: "amber" },
  },
] as unknown as Project[];

const PROPOSAL_ID = "1a0e7c52-3b4d-4e5f-8a6b-7c8d9e0f1a01";
const THREAD_ID = "1a0e7c52-3b4d-4e5f-8a6b-7c8d9e0f1a02";
const TASK_ID = "1a0e7c52-3b4d-4e5f-8a6b-7c8d9e0f1a03";
const INITIATIVE_ID = "1a0e7c52-3b4d-4e5f-8a6b-7c8d9e0f1a04";
const PULL_REQUEST_ID = "1a0e7c52-3b4d-4e5f-8a6b-7c8d9e0f1a05";
const PULL_REQUEST_URL = "https://github.com/acme/billing/pull/42";
const SINCE = "2026-11-21T14:02:00.000Z";

function proposal(
  home: Extract<WaitingForYouItem, { kind: "proposal" }>["home"],
): WaitingForYouItem {
  return {
    kind: "proposal",
    proposalId: PROPOSAL_ID,
    threadId: THREAD_ID,
    draftedBy: "planner",
    home,
    projectIds: ["billing"],
    waitingSince: SINCE,
  };
}

const PULL_REQUEST: WaitingForYouItem = {
  kind: "pull-request",
  pullRequestId: PULL_REQUEST_ID,
  taskId: TASK_ID,
  number: 42,
  url: PULL_REQUEST_URL,
  checksFailing: true,
  conflicts: true,
  projectIds: ["search"],
  waitingSince: SINCE,
};

const SKILL_UPDATES: WaitingForYouItem = {
  kind: "skill-updates",
  skillNames: ["pdf", "xlsx"],
  count: 2,
  projectIds: ["billing"],
  waitingSince: null,
};

const OFFICE_UPDATE: WaitingForYouItem = {
  kind: "office-update",
  target: {
    kind: "release",
    version: "1.4.0",
    name: "v1.4.0",
    publishedAt: SINCE,
    url: "https://github.com/acme/the-office/releases/tag/v1.4.0",
  },
  projectIds: [],
  waitingSince: SINCE,
};

const SHAPING_REPLY: WaitingForYouItem = {
  kind: "shaping-reply",
  initiativeId: INITIATIVE_ID,
  threadId: THREAD_ID,
  roleKey: "reviewer",
  projectIds: ["billing", "search"],
  waitingSince: SINCE,
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
  localStorage.removeItem(PROJECT_FILTER_STORAGE_KEY);
  window.dispatchEvent(new StorageEvent("storage", { key: PROJECT_FILTER_STORAGE_KEY }));
  vi.unstubAllGlobals();
});

function Group(): ReactNode {
  const waitingForYou = useWaitingForYou();
  return waitingForYou ? <WaitingForYouGroup waitingForYou={waitingForYou} /> : null;
}

/** Where the chat drawer is, as the shell's chat holds it. */
function ChatProbe(): ReactNode {
  const { isOpen, roleKey, threadId, proposalId } = useChat();
  return (
    <output data-testid="chat">{JSON.stringify({ isOpen, roleKey, threadId, proposalId })}</output>
  );
}

async function shown(
  waitingForYou: readonly WaitingForYouItem[],
  tasks: readonly Task[] = [],
): Promise<HTMLElement> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  signIn(queryClient);
  queryClient.setQueryData(roleQueries.list().queryKey, [PLANNER, REVIEWER]);
  queryClient.setQueryData(projectQueries.list().queryKey, PROJECTS);
  queryClient.setQueryData(nowQueries.now().queryKey, { waitingForYou } as unknown as Now);
  for (const task of tasks) queryClient.setQueryData(taskQueries.one(task.id).queryKey, task);
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => (
        <ChatProvider>
          <Group />
          <ChatProbe />
        </ChatProvider>
      ),
    }),
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

function card(page: HTMLElement, label: string): HTMLElement {
  const found = page.querySelector<HTMLElement>(`[aria-label="${label}"]`);
  if (!found) throw new Error(`No card ${label}.`);
  return found;
}

function badgeOf(item: HTMLElement): string | null | undefined {
  return item.querySelector(".needs-you-heading")?.firstElementChild?.textContent;
}

function hrefOf(item: HTMLElement): string | null | undefined {
  return item.querySelector("a.needs-you-title")?.getAttribute("href");
}

describe("a Proposal in Waiting for you", () => {
  it("in a chat opens the drafter's chat at its card", async () => {
    const page = await shown([proposal({ kind: "chat", roleKey: "planner" })]);

    const item = card(page, "Proposal: Drafted by Angela");
    expect(badgeOf(item)).toBe("Proposal");
    const title = item.querySelector<HTMLButtonElement>("button.needs-you-title");
    expect(title?.textContent).toBe("Drafted by Angela");

    act(() => title?.click());

    expect(JSON.parse(page.querySelector("[data-testid='chat']")?.textContent ?? "")).toEqual({
      isOpen: true,
      roleKey: "planner",
      threadId: THREAD_ID,
      proposalId: PROPOSAL_ID,
    });
  });

  it("on a Task links to the Task's Thread at its card", async () => {
    const page = await shown([proposal({ kind: "task", taskId: TASK_ID })]);

    const item = card(page, "Proposal: Drafted by Angela");
    expect(badgeOf(item)).toBe("Proposal");
    expect(hrefOf(item)).toBe(`/tasks/${TASK_ID}?taskThread=${THREAD_ID}&proposal=${PROPOSAL_ID}`);
  });

  it("on an Initiative links to the Initiative's Thread at its card", async () => {
    const page = await shown([proposal({ kind: "initiative", initiativeId: INITIATIVE_ID })]);

    const item = card(page, "Proposal: Drafted by Angela");
    expect(hrefOf(item)).toBe(
      `/work/initiatives/${INITIATIVE_ID}?initiativeThread=${THREAD_ID}&proposal=${PROPOSAL_ID}`,
    );
  });
});

describe("the other kinds in Waiting for you", () => {
  it("a pull request links to its Task by title and to GitHub, saying what holds it up", async () => {
    const page = await shown([PULL_REQUEST], [{ id: TASK_ID, title: "Add a filter" } as Task]);

    const item = card(page, "Pull request: Add a filter");
    expect(badgeOf(item)).toBe("Pull request");
    expect(hrefOf(item)).toBe(`/tasks/${TASK_ID}`);
    expect(item.querySelector("a.needs-you-title")?.textContent).toBe("Add a filter");
    const github = item.querySelector<HTMLAnchorElement>("a[target='_blank']");
    expect(github?.textContent).toBe("#42 on GitHub");
    expect(github?.getAttribute("href")).toBe(PULL_REQUEST_URL);
    expect(item.textContent).toContain("Checks failing · Conflicts");
  });

  it("a pull request whose Task isn't read yet is named by its number", async () => {
    const page = await shown([PULL_REQUEST]);

    const item = card(page, "Pull request: #42");
    expect(item.querySelector("a.needs-you-title")?.textContent).toBe("#42");
  });

  it("Skill updates link to Settings › Skills, naming the Skills", async () => {
    const page = await shown([SKILL_UPDATES]);

    const item = card(page, "Skill updates: 2 Skills have updates");
    expect(badgeOf(item)).toBe("Skill updates");
    expect(hrefOf(item)).toBe("/settings/skills");
    expect(item.textContent).toContain("pdf, xlsx");
    expect(item.querySelector("time")).toBeNull();
  });

  it("an Office update links to Settings › Updates, naming the version or the commit", async () => {
    const page = await shown([
      OFFICE_UPDATE,
      {
        ...OFFICE_UPDATE,
        target: {
          kind: "commit",
          commit: "abc1234def5678",
          shortCommit: "abc1234",
          subject: "fix: a thing",
          committedAt: SINCE,
        },
      },
    ]);

    const release = card(page, "Office update: Version 1.4.0 is available");
    expect(badgeOf(release)).toBe("Office update");
    expect(hrefOf(release)).toBe("/settings/updates");
    expect(hrefOf(card(page, "Office update: Commit abc1234 is available"))).toBe(
      "/settings/updates",
    );
  });

  it("a shaping reply links to the Initiative's shaping Thread", async () => {
    const page = await shown([SHAPING_REPLY]);

    const item = card(page, "Shaping reply: Michael answered");
    expect(badgeOf(item)).toBe("Shaping reply");
    expect(hrefOf(item)).toBe(`/work/initiatives/${INITIATIVE_ID}?initiativeThread=${THREAD_ID}`);
  });
});

describe("the Waiting for you group", () => {
  it("is headed with its count", async () => {
    const page = await shown([SKILL_UPDATES, OFFICE_UPDATE]);

    const group = page.querySelector("section[aria-label='Waiting for you']");
    expect(group?.querySelector(".waiting-for-you-heading")?.textContent).toBe("Waiting for you2");
  });

  it("leaves out another Project's item, counted in other Projects, and keeps an Office-wide one", async () => {
    localStorage.setItem(PROJECT_FILTER_STORAGE_KEY, JSON.stringify(["billing"]));
    const page = await shown([PULL_REQUEST, SKILL_UPDATES, OFFICE_UPDATE]);
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: PROJECT_FILTER_STORAGE_KEY }));
    });

    expect(page.querySelector("[aria-label^='Pull request: ']")).toBeNull();
    expect(page.querySelector("[aria-label^='Skill updates: ']")).not.toBeNull();
    expect(page.querySelector("[aria-label^='Office update: ']")).not.toBeNull();
    expect(page.querySelector(".waiting-for-you-count")?.textContent).toBe("2");
    expect(page.textContent).toContain("1 more waits for you in other Projects");
  });

  it("shows nothing while no item is shown", async () => {
    localStorage.setItem(PROJECT_FILTER_STORAGE_KEY, JSON.stringify(["billing"]));
    const page = await shown([PULL_REQUEST]);
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: PROJECT_FILTER_STORAGE_KEY }));
    });

    expect(page.querySelector("section[aria-label='Waiting for you']")).toBeNull();
    expect(page.textContent).not.toContain("in other Projects");
  });

  it("shows nothing with nothing waiting", async () => {
    const page = await shown([]);

    expect(page.querySelector("section[aria-label='Waiting for you']")).toBeNull();
  });
});
