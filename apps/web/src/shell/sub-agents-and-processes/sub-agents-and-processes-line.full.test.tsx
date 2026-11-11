import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Thread } from "@the-office/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThreadEventsContext } from "../../api/event-stream-provider.tsx";
import { roleQueries } from "../../api/people.ts";
import {
  aProcess,
  aSubAgent,
  endedAfter,
  itemEvent,
  TestService,
  TestThreadEvents,
  THREAD_ID,
} from "./sub-agents-and-processes.fixtures.ts";
import { SubAgentsAndProcessesLine } from "./sub-agents-and-processes-line.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const THREAD = {
  id: THREAD_ID,
  home: { kind: "chat", roleKey: "developer" },
  title: "Try a search index",
  consultation: null,
} as Thread;

let service: TestService;
let events: TestThreadEvents;
let root: Root | undefined;

beforeEach(() => {
  service = new TestService();
  events = new TestThreadEvents();
  vi.stubGlobal("fetch", service.fetch);
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

async function rendered(onShow?: () => void): Promise<HTMLElement> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  queryClient.setQueryData(roleQueries.list().queryKey, []);
  const page = document.createElement("div");
  document.body.append(page);
  root = createRoot(page);
  await act(async () =>
    root?.render(
      <QueryClientProvider client={queryClient}>
        <ThreadEventsContext value={events}>
          <SubAgentsAndProcessesLine thread={THREAD} personName="Jim" onShow={onShow} />
        </ThreadEventsContext>
      </QueryClientProvider>,
    ),
  );
  await settled();
  return page;
}

async function settled(): Promise<void> {
  for (let round = 0; round < 5; round += 1) {
    await act(async () => await new Promise((resolve) => setTimeout(resolve, 0)));
  }
}

function line(page: HTMLElement): HTMLButtonElement | null {
  return page.querySelector(".sub-agents-and-processes-line");
}

const ended = (milliseconds: number) =>
  ({
    state: "finished",
    ending: { state: "finished" },
    endedAt: endedAfter(milliseconds),
  }) as const;
const failed = {
  state: "failed",
  ending: { state: "failed", reason: "" },
  endedAt: endedAfter(1000),
} as const;

describe("the line", () => {
  it("doesn't show while the session has had no Sub-agent or Process", async () => {
    expect(line(await rendered())).toBeNull();
  });

  it("says what runs with the live dot, and how many ended and failed", async () => {
    service.list = [
      aSubAgent({ callId: "a" }),
      aSubAgent({ callId: "b" }),
      aProcess({ callId: "c" }),
      aSubAgent({ callId: "d", ...ended(1000) }),
      aProcess({ callId: "e", ...ended(2000) }),
      aProcess({ callId: "f", ...failed }),
    ];
    const shown = line(await rendered());
    expect(shown?.getAttribute("aria-label")).toBe(
      "2 sub-agents, 1 process running · 3 ended, 1 failed. Show them.",
    );
    expect(shown?.querySelector(".live-dot")).not.toBeNull();
    expect(shown?.querySelector(".failed")?.textContent).toBe("1 failed");
    expect(shown?.textContent).toContain("Show");
  });

  it("says how many ended, without the dot, once none runs", async () => {
    service.list = [
      aSubAgent({ callId: "a", ...ended(1000) }),
      aSubAgent({ callId: "b", ...ended(1000) }),
      aSubAgent({ callId: "c", ...ended(1000) }),
      aProcess({ callId: "d", ...ended(1000) }),
    ];
    const shown = line(await rendered());
    expect(shown?.querySelector(".sub-agents-and-processes-line-text")?.textContent).toBe(
      "3 sub-agents, 1 process ended",
    );
    expect(shown?.querySelector(".live-dot")).toBeNull();
  });

  it("shows as the first one starts, with the page open", async () => {
    const page = await rendered();
    await act(async () => events.send(itemEvent("thread.process-started", aProcess())));
    await settled();
    expect(line(page)?.textContent).toContain("1 process running");
  });

  it("opens the read-only window, which offers no stop control", async () => {
    service.list = [aProcess()];
    const page = await rendered();
    await act(async () => line(page)?.click());
    await settled();
    const window = document.querySelector('[role="dialog"]');
    expect(window?.querySelector("h2")?.textContent).toContain("Sub-agents and processes");
    expect(window?.textContent).toContain("Read-only: only the Agent can stop them");
    const buttons = [...(window?.querySelectorAll("button") ?? [])].map(
      ({ textContent }) => textContent ?? "",
    );
    expect(buttons.filter((words) => /stop/i.test(words))).toEqual([]);
  });

  it("does what the place gives instead, opening no window", async () => {
    service.list = [aProcess()];
    const onShow = vi.fn<() => void>();
    const page = await rendered(onShow);
    await act(async () => line(page)?.click());
    expect(onShow).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
