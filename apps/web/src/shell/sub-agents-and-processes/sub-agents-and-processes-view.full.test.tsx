import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { SubAgentMessage } from "@the-office/contracts";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThreadEventsContext } from "../../api/event-stream-provider.tsx";
import { roleQueries } from "../../api/people.ts";
import {
  aProcess,
  aSubAgent,
  endedAfter,
  itemEvent,
  messagesEvent,
  outputEvent,
  STARTED_AT,
  TestService,
  TestThreadEvents,
  THREAD_ID,
} from "./sub-agents-and-processes.fixtures.ts";
import { SubAgentsAndProcessesView } from "./sub-agents-and-processes-view.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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

async function rendered(view: ReactNode = <View />): Promise<HTMLElement> {
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
        <ThreadEventsContext value={events}>{view}</ThreadEventsContext>
      </QueryClientProvider>,
    ),
  );
  await settled();
  return page;
}

function View(): ReactNode {
  return <SubAgentsAndProcessesView threadId={THREAD_ID} personName="Jim" />;
}

/** Lets the reads answer and what they set render. */
async function settled(): Promise<void> {
  for (let round = 0; round < 5; round += 1) {
    await act(async () => await new Promise((resolve) => setTimeout(resolve, 0)));
  }
}

async function sent(event: Parameters<TestThreadEvents["send"]>[0]): Promise<void> {
  await act(async () => events.send(event));
  await settled();
}

async function pressed(element: Element | null | undefined): Promise<void> {
  if (!(element instanceof HTMLElement)) throw new Error("Nothing to press.");
  await act(async () => element.click());
  await settled();
}

function itemTitles(page: HTMLElement, group: string): string[] {
  return [
    ...page.querySelectorAll(
      `[role="group"][aria-label="${group}"] .sub-agents-and-processes-item-title`,
    ),
  ].map((title) => title.textContent ?? "");
}

function item(page: HTMLElement, title: string): Element | undefined {
  return [...page.querySelectorAll(".sub-agents-and-processes-item")].find((each) =>
    each.textContent?.includes(title),
  );
}

function output(page: HTMLElement): HTMLElement {
  const box = page.querySelector<HTMLElement>('[aria-label="Output"]');
  if (box === null) throw new Error("No output shows.");
  return box;
}

const chunk = (sequence: number) => ({ sequence, text: `line ${sequence}\n` });

const finishedProcess = aProcess({
  callId: "toolu_tests",
  description: "Run the tests",
  state: "finished",
  ending: { state: "finished" },
  exitCode: 0,
  endedAt: endedAfter(30_000),
});
const failedProcess = aProcess({
  callId: "toolu_e2e",
  description: "",
  commandLine: "npm run test:e2e",
  state: "failed",
  ending: { state: "failed", reason: "" },
  exitCode: 1,
  endedAt: endedAfter(190_000),
});
const devServer = aProcess();
const explore = aSubAgent();

describe("the list", () => {
  it("puts what runs on top, then what ended, the one that ended last first", async () => {
    service.list = [finishedProcess, explore, failedProcess];
    const page = await rendered();
    expect(itemTitles(page, "Running")).toEqual([explore.description]);
    expect(itemTitles(page, "Ended")).toEqual(["npm run test:e2e", "Run the tests"]);
    expect(item(page, "npm run test:e2e")?.textContent).toContain(
      "Process · Failed · exit code 1 · 3m 10s",
    );
  });

  it("sees items start, change and end without a reload, whatever order their events come in", async () => {
    service.list = [explore];
    const page = await rendered();
    const ended = {
      ...devServer,
      state: "finished",
      ending: { state: "finished" },
      exitCode: 0,
      endedAt: endedAfter(5000),
      revision: 2,
    } as const;
    await sent(itemEvent("thread.process-ended", ended));
    expect(itemTitles(page, "Ended")).toEqual([devServer.description]);
    await sent(itemEvent("thread.process-started", devServer));
    expect(itemTitles(page, "Running")).toEqual([explore.description]);
    expect(itemTitles(page, "Ended")).toEqual([devServer.description]);
  });

  it("stacks the list and the details on a narrow view, with a way back to the list", async () => {
    service.list = [explore, finishedProcess];
    const page = await rendered();
    const view = page.querySelector(".sub-agents-and-processes");
    expect(view?.getAttribute("data-pane")).toBe("list");
    await pressed(item(page, "Run the tests"));
    expect(view?.getAttribute("data-pane")).toBe("details");
    expect(item(page, "Run the tests")?.getAttribute("aria-current")).toBe("true");
    const back = [...page.querySelectorAll("button")].find(
      (button) => button.textContent === "All sub-agents and processes",
    );
    await pressed(back);
    expect(view?.getAttribute("data-pane")).toBe("list");
  });
});

describe("a Process's details", () => {
  it("shows its command whole and the output so far, then each new chunk once", async () => {
    service.list = [devServer];
    service.output.set(devServer.callId, [chunk(1), chunk(2)]);
    const page = await rendered();
    expect(page.querySelector(".sub-agents-and-processes-command")?.textContent).toBe(
      devServer.commandLine,
    );
    expect(output(page).textContent).toBe("line 1\nline 2\n");
    await sent(outputEvent(devServer.callId, 2, "line 2\n"));
    await sent(outputEvent(devServer.callId, 3, "line 3\n"));
    expect(output(page).textContent).toBe("line 1\nline 2\nline 3\n");
  });

  it("reads again from the last chunk it has after a gap and after a reconnect", async () => {
    service.list = [devServer];
    service.output.set(devServer.callId, [chunk(1)]);
    const page = await rendered();
    service.output.set(devServer.callId, [chunk(1), chunk(2), chunk(3)]);
    await sent(outputEvent(devServer.callId, 3, "line 3\n"));
    expect(service.reads).toContain(
      `/api/threads/${THREAD_ID}/processes/${devServer.callId}/output?after=1`,
    );
    expect(output(page).textContent).toBe("line 1\nline 2\nline 3\n");

    service.output.set(devServer.callId, [chunk(1), chunk(2), chunk(3), chunk(4)]);
    await act(async () => events.reconnect());
    await settled();
    expect(service.reads).toContain(
      `/api/threads/${THREAD_ID}/processes/${devServer.callId}/output?after=3`,
    );
    expect(output(page).textContent).toBe("line 1\nline 2\nline 3\nline 4\n");
  });

  it("follows the end until the reader scrolls up, then offers Jump to the end", async () => {
    service.list = [devServer];
    service.output.set(devServer.callId, [chunk(1)]);
    const page = await rendered();
    const box = output(page);
    Object.defineProperty(box, "scrollHeight", { configurable: true, value: 1000 });
    Object.defineProperty(box, "clientHeight", { configurable: true, value: 200 });
    await sent(outputEvent(devServer.callId, 2, "line 2\n"));
    expect(box.scrollTop).toBe(1000);
    expect(page.textContent).toContain("Following the end");

    box.scrollTop = 300;
    await act(async () => box.dispatchEvent(new Event("scroll")));
    await sent(outputEvent(devServer.callId, 3, "line 3\n"));
    expect(box.scrollTop).toBe(300);
    const jump = [...page.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Jump to the end"),
    );
    await pressed(jump);
    expect(box.scrollTop).toBe(1000);
    expect(page.textContent).toContain("Following the end");
  });

  it("says how it ended and how much earlier output isn't kept", async () => {
    service.list = [failedProcess];
    service.earlierOutputNotKept = Math.round(1.9 * 1024 * 1024);
    const page = await rendered();
    expect(page.querySelector(".sub-agents-and-processes-ending.failed")?.textContent).toContain(
      "Failed with exit code 1",
    );
    expect(page.textContent).toContain("1.9 MB of earlier output isn't kept.");
    expect(page.textContent).not.toContain("Following the end");
  });

  it("offers no stop control", async () => {
    service.list = [devServer, explore];
    const page = await rendered();
    const buttons = [...page.querySelectorAll("button")].map((button) => button.textContent ?? "");
    expect(buttons.filter((words) => /stop/i.test(words))).toEqual([]);
  });
});

describe("the streams", () => {
  it("are subscribed to, for the Thread, only while the view shows that item", async () => {
    service.list = [devServer, explore];
    const page = await rendered();
    expect(events.subscribedTypes()).toContain("thread.process-output");
    expect(events.subscribedTypes()).not.toContain("thread.sub-agent-messages");
    await pressed(item(page, explore.description));
    expect(events.subscribedTypes()).toContain("thread.sub-agent-messages");
    expect(events.subscribedTypes()).not.toContain("thread.process-output");
    act(() => root?.unmount());
    root = undefined;
    expect(events.subscribedTypes()).toEqual([]);
  });
});

const said = (sequence: number, text: string): SubAgentMessage => ({
  kind: "text",
  sequence,
  at: STARTED_AT,
  text,
});

describe("a Sub-agent's details", () => {
  it("shows its prompt folded with Read it in full, and its messages in Rows", async () => {
    const prompt = Array.from({ length: 6 }, (_, line) => `Step ${line + 1} of the search.`).join(
      "\n",
    );
    service.list = [aSubAgent({ prompt })];
    service.messages.set(explore.callId, [said(1, "The service reads Threads in two places.")]);
    const page = await rendered();
    expect(page.querySelector(".sub-agents-and-processes-prompt.folded")).not.toBeNull();
    await pressed(
      [...page.querySelectorAll("button")].find(
        ({ textContent }) => textContent === "Read it in full",
      ),
    );
    expect(page.querySelector(".sub-agents-and-processes-prompt.folded")).toBeNull();
    expect(page.querySelector('[role="group"][aria-label="Details"]')).not.toBeNull();
    expect(page.querySelector(".message-list")?.textContent).toContain(
      "The service reads Threads in two places.",
    );
    expect(page.textContent).toContain("Explore sub-agent is working");

    await sent(messagesEvent(explore.callId, [said(2, "And searches them in one.")]));
    expect(page.querySelector(".message-list")?.textContent).toContain("And searches them in one.");
  });

  it("shows what it reported back once it ended, or how it failed", async () => {
    service.list = [explore];
    const page = await rendered();
    await sent(
      itemEvent("thread.sub-agent-ended", {
        ...explore,
        state: "finished",
        ending: { state: "finished" },
        endedAt: endedAfter(60_000),
        reportedBack: "Threads are read in `thread-reads.ts`.",
        revision: 1,
      }),
    );
    expect(page.querySelector('[aria-label="Reported back"]')?.textContent).toContain(
      "Reported back to Jim",
    );
    expect(page.textContent).not.toContain("is working");

    await sent(
      itemEvent("thread.sub-agent-ended", {
        ...aSubAgent({ callId: "toolu_review", description: "Review the migration" }),
        state: "failed",
        ending: { state: "failed", reason: "Its context window filled." },
        endedAt: endedAfter(90_000),
        revision: 1,
      }),
    );
    await pressed(item(page, "Review the migration"));
    expect(page.querySelector(".sub-agents-and-processes-ending.failed")?.textContent).toContain(
      "Its context window filled.",
    );
  });
});
