import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Thread, ThreadContext } from "@the-office/contracts";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chooseContextOverride, sendMessage } from "../../api/conversations.ts";
import { roleQueries } from "../../api/people.ts";
import { HandoverNotesProvider } from "../conversation/handover-notes.tsx";
import { ThreadComposer } from "../conversation/thread-composer.tsx";
import { ThreadDraftsProvider } from "../conversation/thread-drafts.tsx";
import { SkillCommandClash } from "./command-notes.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Only the message box matters here: the lines around it read the service on their own.
vi.mock("../fire-alarm/alarm-note.tsx", () => ({ AlarmNote: (): ReactNode => null }));
vi.mock("../sub-agents-and-processes/sub-agents-and-processes-line.tsx", () => ({
  SubAgentsAndProcessesLine: (): ReactNode => null,
}));
vi.mock("../conversation/context-reading.tsx", () => ({
  SessionRow: (): ReactNode => null,
  ContextReading: (): ReactNode => null,
}));
vi.mock("../conversation/context-reading-words.ts", () => ({ threadReadingLook: () => ({}) }));
vi.mock("../../api/conversations.ts", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  chooseContextOverride: vi.fn<typeof chooseContextOverride>(),
  sendMessage: vi.fn<typeof sendMessage>(),
}));

const SKILL_COMMANDS = [
  { name: "review-pr", description: "Review a pull request." },
  { name: "changelog", description: "Write the changelog." },
];

function aThread(fields: { stageThread?: boolean; context?: Partial<ThreadContext> } = {}): Thread {
  return {
    id: "thread-1",
    state: "idle",
    stageThread: fields.stageThread ?? false,
    skillCommands: SKILL_COMMANDS,
    context: {
      move: "resume",
      reason: "cache-warm",
      alternatives: [{ override: "start-fresh", tokens: 3_000 }],
      override: null,
      ...fields.context,
    },
  } as unknown as Thread;
}

let page: HTMLDivElement;
let root: Root;

beforeEach(() => {
  page = document.createElement("div");
  document.body.append(page);
  root = createRoot(page);
  vi.mocked(chooseContextOverride).mockReset();
  vi.mocked(sendMessage).mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  page.remove();
});

function show(thread: Thread): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  queryClient.setQueryData(roleQueries.list().queryKey, []);
  act(() =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <HandoverNotesProvider>
          <ThreadDraftsProvider>
            <ThreadComposer thread={thread} personName="Jan" />
          </ThreadDraftsProvider>
        </HandoverNotesProvider>
      </QueryClientProvider>,
    ),
  );
}

function field(): HTMLTextAreaElement {
  const box = page.querySelector("textarea");
  if (!box) throw new Error("No message box.");
  return box;
}

function type(text: string): void {
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  act(() => {
    setValue?.call(field(), text);
    field().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function press(key: string): Promise<void> {
  await act(async () => {
    field().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    await Promise.resolve();
  });
}

function listed(): string[][] {
  return [...page.querySelectorAll('[role="option"]')].map((option) => [
    option.querySelector(".command-picker-name")?.textContent ?? "",
    option.querySelector(".mention-picker-kind")?.textContent ?? "",
  ]);
}

function note(): string | undefined {
  return page.querySelector(".command-note")?.textContent ?? undefined;
}

describe("the commands of a Thread's message box", () => {
  it("lists the Office commands first, then the Thread's skill commands, each by its kind", () => {
    show(aThread());
    type("/");
    expect(listed()).toEqual([
      ["/clear", "Office command"],
      ["/help", "Office command"],
      ["/review-pr", "Skill command"],
      ["/changelog", "Skill command"],
    ]);
    expect(page.querySelector('[role="option"]')?.textContent).toContain(
      "Start the next message in a fresh session.",
    );
  });

  it("narrows the list by what is typed, and closes it once the name is followed by a space", () => {
    show(aThread());
    type("/c");
    expect(listed().map(([name]) => name)).toEqual(["/clear", "/changelog"]);
    type("/ch");
    expect(listed().map(([name]) => name)).toEqual(["/changelog"]);
    type("/changelog ");
    expect(listed()).toEqual([]);
    type("Hello /c");
    expect(listed()).toEqual([]);
  });

  it("completes the command picked with the arrows and Tab", async () => {
    show(aThread());
    type("/");
    await press("ArrowDown");
    await press("ArrowDown");
    await press("Tab");
    expect(field().value).toBe("/review-pr ");
  });

  it("leaves / ordinary in a Stage Thread", () => {
    show(aThread({ stageThread: true, context: { alternatives: [] } }));
    type("/");
    expect(listed()).toEqual([]);
  });

  it("runs /clear as Start fresh for the next message, sending nothing", async () => {
    vi.mocked(chooseContextOverride).mockResolvedValue({
      ...aThread(),
      context: { ...aThread().context, override: "start-fresh" },
    });
    show(aThread());
    type("/clear");
    await press("Enter");
    expect(chooseContextOverride).toHaveBeenCalledWith("thread-1", "start-fresh");
    expect(sendMessage).not.toHaveBeenCalled();
    expect(field().value).toBe("");
    await vi.waitFor(() => expect(note()).toContain("Your next message starts a fresh session."));
  });

  it("says there's no session to start fresh yet where Start fresh isn't offered", async () => {
    show(aThread({ context: { move: "fresh", reason: "new-thread", alternatives: [] } }));
    type("/clear");
    await press("Enter");
    expect(chooseContextOverride).not.toHaveBeenCalled();
    expect(note()).toContain("There's no session to start fresh yet");
  });

  it("lists the commands for /help with no request, until Esc", async () => {
    show(aThread());
    type("/help");
    await press("Enter");
    expect(sendMessage).not.toHaveBeenCalled();
    expect(chooseContextOverride).not.toHaveBeenCalled();
    expect(note()).toContain("/clearStart the next message in a fresh session.Office command");
    expect(note()).toContain("/changelogWrite the changelog.Skill command");
    await press("Escape");
    expect(note()).toBeUndefined();
  });

  it("closes /help's note with the next message, which is sent as before", async () => {
    vi.mocked(sendMessage).mockResolvedValue(aThread());
    show(aThread());
    type("/help");
    await press("Enter");
    type("/review-pr the login form");
    await press("Enter");
    expect(note()).toBeUndefined();
    expect(sendMessage).toHaveBeenCalledWith("thread-1", { text: "/review-pr the login form" });
  });

  it("sends a message whose first character isn't the '/' as an ordinary one", async () => {
    vi.mocked(sendMessage).mockResolvedValue(aThread());
    show(aThread());
    type(" /help");
    await press("Enter");
    expect(note()).toBeUndefined();
    expect(sendMessage).toHaveBeenCalledOnce();
  });
});

describe("a skill named like an Office command, where a Role card assigns it", () => {
  it("warns, and says nothing of any other skill", () => {
    act(() =>
      root.render(
        <>
          <SkillCommandClash skillName="clear" />
          <SkillCommandClash skillName="review-pr" />
        </>,
      ),
    );
    expect(page.textContent).toBe(
      "/clear is an Office command, so the skill can't run as a skill command.",
    );
  });
});
