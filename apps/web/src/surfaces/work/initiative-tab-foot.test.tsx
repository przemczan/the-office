import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Thread } from "@the-office/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThreadEventsContext } from "../../api/event-stream-provider.tsx";
import { roleQueries } from "../../api/people.ts";
import {
  aProcess,
  TestService,
  TestThreadEvents,
  THREAD_ID,
} from "../../shell/sub-agents-and-processes/sub-agents-and-processes.fixtures.ts";
import { InitiativeTabFoot } from "./initiative-tab-foot.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const DROPPED =
  "This Initiative was dropped, so you can read this conversation but not continue it.";

const SHAPING = {
  id: THREAD_ID,
  home: { kind: "initiative", initiativeId: "3f0c2b1a-9d8e-4f7a-8b6c-5d4e3f2a1b0c" },
  roleKey: "cto",
  title: "Shaping",
  consultation: null,
} as Thread;

let service: TestService;
let root: Root | undefined;

beforeEach(() => {
  service = new TestService();
  vi.stubGlobal("fetch", service.fetch);
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

async function rendered(): Promise<HTMLElement> {
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
        <ThreadEventsContext value={new TestThreadEvents()}>
          <InitiativeTabFoot
            threads={[SHAPING]}
            toId={THREAD_ID}
            personName="Bob"
            personLabel="Bob · CTO"
            readOnlyReason={DROPPED}
            onDrafting={() => undefined}
            onSent={() => undefined}
            onChoose={() => undefined}
          />
        </ThreadEventsContext>
      </QueryClientProvider>,
    ),
  );
  for (let round = 0; round < 5; round += 1) {
    await act(async () => await new Promise((resolve) => setTimeout(resolve, 0)));
  }
  return page;
}

describe("an ended Initiative's tab foot", () => {
  it("shows the Thread's Sub-agents and processes line above the read-only note, opening its window", async () => {
    service.list = [aProcess()];
    const page = await rendered();

    const foot = page.querySelector(".timeline-foot");
    expect([...(foot?.children ?? [])].map(({ className }) => className)).toEqual([
      "sub-agents-and-processes-line",
      "thread-read-only",
    ]);
    expect(page.querySelector("textarea")).toBeNull();
    expect(page.textContent).toContain(DROPPED);

    await act(async () =>
      page.querySelector<HTMLButtonElement>(".sub-agents-and-processes-line")?.click(),
    );
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "Sub-agents and processes",
    );
  });
});
