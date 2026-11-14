import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import type { Attachment, Stage, StageRun, TaskStage, Thread } from "@the-office/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { threadQueries } from "../../api/conversations.ts";
import { ThreadEventsContext } from "../../api/event-stream-provider.tsx";
import { roleQueries } from "../../api/people.ts";
import { attachmentQueries } from "../../api/work.ts";
import {
  aProcess,
  TestService,
  TestThreadEvents,
  THREAD_ID,
} from "../../shell/sub-agents-and-processes/sub-agents-and-processes.fixtures.ts";
import { NO_TOKENS } from "../../shell/token-words.ts";
import { RunDetails } from "./run-details.tsx";
import type { RunTab } from "./stage-history-words.ts";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const TASK_ID = "00000000-0000-4000-8000-000000000001";
const gate: Stage = { kind: "gate", key: "look", name: "UI acceptance", optional: false };

function aRun(fields: Pick<StageRun, "id" | "number" | "startedAt" | "endedAt">): StageRun {
  return {
    waitingSince: null,
    threadId: null,
    session: null,
    tokens: NO_TOKENS,
    context: null,
    carriedFailure: null,
    sentBack: null,
    commandRuns: [],
    gateAction: null,
    outcome: {
      status: "done",
      summary: "The Task reached the Gate and waited for the user.",
      skipped: false,
      definitionOfDoneMet: null,
      pullRequestUrl: null,
      handoverNote: null,
    },
    ...fields,
  };
}

const firstRun: StageRun = {
  ...aRun({
    id: "00000000-0000-4000-8000-00000000000a",
    number: 1,
    startedAt: "2026-11-04T10:00:00.000Z",
    endedAt: "2026-11-04T11:00:00.000Z",
  }),
  gateAction: { kind: "continue" },
};
const secondRun = aRun({
  id: "00000000-0000-4000-8000-00000000000b",
  number: 2,
  startedAt: "2026-11-04T11:20:00.000Z",
  endedAt: "2026-11-04T11:20:00.100Z",
});
const gateStage: TaskStage = {
  stage: gate,
  state: "waiting-on-you",
  tokens: NO_TOKENS,
  wentBack: null,
  runs: [firstRun, secondRun],
};

function anAttachment(
  kind: Attachment["kind"],
  name: string,
  addedAt: string,
  mediaType: string,
): Attachment {
  return {
    kind,
    id: crypto.randomUUID(),
    owner: { kind: "task", taskId: TASK_ID },
    name,
    addedBy: { kind: "person", roleKey: "developer" },
    addedAt,
    mediaType,
    size: 1024,
    text: kind === "document",
  } as Attachment;
}

function showRun(run: StageRun, attachments: readonly Attachment[]): HTMLElement {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  queryClient.setQueryData(
    attachmentQueries.of({ kind: "task", taskId: TASK_ID }).queryKey,
    attachments as Attachment[],
  );
  const page = document.createElement("div");
  act(() =>
    createRoot(page).render(
      <QueryClientProvider client={queryClient}>
        <RunDetails
          taskId={TASK_ID}
          stages={[gateStage]}
          taskStage={gateStage}
          run={run}
          tab="summary"
          roles={[]}
          names={(key) => key}
          now={new Date("2026-11-04T13:00:00.000Z")}
          onTab={() => undefined}
          onReadSummary={() => undefined}
          onClose={() => undefined}
        />
      </QueryClientProvider>,
    ),
  );
  return page;
}

function shownIn(page: HTMLElement): HTMLElement | null {
  return page.querySelector('[aria-label="Attachments"]');
}

function thumbnail(page: HTMLElement, name: string): Element | null {
  return page.querySelector(`[aria-label="View ${name}"]`);
}

describe("a Gate's run", () => {
  const attachments = [
    anAttachment("image", "first.png", "2026-11-04T10:30:00.000Z", "image/png"),
    anAttachment("image", "second.png", "2026-11-04T11:30:00.000Z", "image/png"),
    anAttachment("document", "notes.md", "2026-11-04T11:40:00.000Z", "text/markdown"),
  ];

  it("shows the Attachments of that run alone, each of the Gate's runs its own", () => {
    const first = showRun(firstRun, attachments);
    expect(thumbnail(first, "first.png")).not.toBeNull();
    expect(thumbnail(first, "second.png")).toBeNull();
    expect(shownIn(first)?.textContent).not.toContain("notes.md");

    const second = showRun(secondRun, attachments);
    expect(thumbnail(second, "first.png")).toBeNull();
    expect(thumbnail(second, "second.png")).not.toBeNull();
    expect(shownIn(second)?.textContent).toContain("notes.md");
  });

  it("shows no Attachments heading for a run that has none", () => {
    expect(shownIn(showRun(secondRun, attachments.slice(0, 1)))).toBeNull();
  });
});

function tabNames(page: HTMLElement): string[] {
  return [...page.querySelectorAll('[role="tab"]')].map(({ textContent }) => textContent ?? "");
}

describe("an Agent run's Sub-agents and processes", () => {
  const implement = {
    kind: "agent",
    key: "implement",
    name: "Implement",
    role: "developer",
  } as Stage;
  const endedRun: StageRun = {
    ...aRun({
      id: "00000000-0000-4000-8000-00000000000c",
      number: 1,
      startedAt: "2026-11-04T10:00:00.000Z",
      endedAt: "2026-11-04T11:00:00.000Z",
    }),
    threadId: THREAD_ID,
  };
  const implementStage: TaskStage = {
    stage: implement,
    state: "done",
    tokens: NO_TOKENS,
    wentBack: null,
    runs: [endedRun],
  };
  const stageThread = {
    id: THREAD_ID,
    home: { kind: "task", taskId: TASK_ID },
    roleKey: "developer",
    title: null,
    state: "waiting",
    stageThread: true,
    consultation: null,
  } as Thread;

  afterEach(() => {
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  async function showAgentRun(
    tab: RunTab,
    service: TestService,
    onTab: (tab: RunTab) => void = () => undefined,
  ): Promise<HTMLElement> {
    vi.stubGlobal("fetch", service.fetch);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity, retry: false } },
    });
    queryClient.setQueryData(roleQueries.list().queryKey, []);
    queryClient.setQueryData(threadQueries.one(THREAD_ID).queryKey, stageThread);
    queryClient.setQueryData(threadQueries.messages(THREAD_ID).queryKey, []);
    const rootRoute = createRootRoute();
    const taskRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/tasks/$taskId",
      component: () => (
        <RunDetails
          taskId={TASK_ID}
          stages={[implementStage]}
          taskStage={implementStage}
          run={endedRun}
          tab={tab}
          roles={[]}
          names={(key) => key}
          now={new Date("2026-11-04T13:00:00.000Z")}
          onTab={onTab}
          onReadSummary={() => undefined}
          onClose={() => undefined}
        />
      ),
    });
    const router = createRouter({
      routeTree: rootRoute.addChildren([taskRoute]),
      history: createMemoryHistory({ initialEntries: [`/tasks/${TASK_ID}`] }),
    });
    const page = document.createElement("div");
    document.body.append(page);
    await act(async () => {
      createRoot(page).render(
        <QueryClientProvider client={queryClient}>
          <ThreadEventsContext value={new TestThreadEvents()}>
            <RouterProvider router={router} />
          </ThreadEventsContext>
        </QueryClientProvider>,
      );
      await router.load();
    });
    for (let round = 0; round < 5; round += 1) {
      await act(async () => await new Promise((resolve) => setTimeout(resolve, 0)));
    }
    return page;
  }

  it("has no third tab for a run whose Thread had none", async () => {
    const page = await showAgentRun("thread", new TestService());
    expect(tabNames(page)).toEqual(["Summary", "Thread"]);
    expect(page.querySelector(".sub-agents-and-processes-line")).toBeNull();
  });

  it("shows the view in its third tab, with the count, for a run that had any", async () => {
    const service = new TestService();
    service.list = [aProcess(), aProcess({ callId: "toolu_tests" })];
    const page = await showAgentRun("sub-agents-and-processes", service);
    expect(tabNames(page)).toEqual(["Summary", "Thread", "Sub-agents and processes 2"]);
    expect(page.querySelector(".sub-agents-and-processes")).not.toBeNull();
    expect(page.textContent).toContain("Read-only: only the Agent can stop them");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("switches to that tab from the line in the Thread tab, opening no window", async () => {
    const service = new TestService();
    service.list = [aProcess()];
    const onTab = vi.fn<(tab: RunTab) => void>();
    const page = await showAgentRun("thread", service, onTab);
    const line = page.querySelector<HTMLElement>(".sub-agents-and-processes-line");
    await act(async () => line?.click());
    expect(onTab).toHaveBeenCalledWith("sub-agents-and-processes");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
