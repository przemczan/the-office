import type { Thread } from "@the-office/contracts";
import { act, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stopThread } from "../../api/conversations.ts";
import {
  aThread,
  showComposer,
  THREAD_ID,
  type ShownComposer,
} from "./composer-images.fixtures.tsx";

vi.mock("../fire-alarm/alarm-note.tsx", () => ({ AlarmNote: (): ReactNode => null }));
vi.mock("../sub-agents-and-processes/sub-agents-and-processes-line.tsx", () => ({
  SubAgentsAndProcessesLine: (): ReactNode => null,
}));
vi.mock("./context-reading.tsx", () => ({
  SessionRow: (): ReactNode => null,
  ContextReading: (): ReactNode => null,
}));
vi.mock("./context-reading-words.ts", () => ({ threadReadingLook: () => ({}) }));
vi.mock("../../api/conversations.ts", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  stopThread: vi.fn<typeof stopThread>(),
}));

let shown: ShownComposer | undefined;

function answering(change: Partial<Thread> = {}): Thread {
  return { ...aThread(), state: "answering", consultation: null, ...change };
}

function stopButton(composer: ShownComposer): HTMLButtonElement | null {
  return composer.page.querySelector<HTMLButtonElement>('button[aria-label^="Stop"]');
}

beforeEach(() => {
  vi.mocked(stopThread).mockReset();
  vi.mocked(stopThread).mockResolvedValue({ stopped: true, sessionEnded: false });
});
afterEach(() => {
  shown?.unmount();
  shown = undefined;
});

describe("Stop in a person's Thread", () => {
  it("shows a Stop button named for the person while they answer, beside Send", () => {
    shown = showComposer(answering());

    expect(stopButton(shown)?.getAttribute("aria-label")).toBe("Stop Jan");
    expect(shown.sendButton().getAttribute("aria-label")).toBe("Send (Enter)");
  });

  it("shows none between turns, in a Stage Thread or in a Consultation", () => {
    for (const thread of [
      { ...answering(), state: "waiting" as const },
      answering({ stageThread: true }),
      answering({
        consultation: { decisionId: THREAD_ID, askerThreadId: THREAD_ID, askerRoleKey: null },
      }),
    ]) {
      shown = showComposer(thread);
      expect(stopButton(shown)).toBeNull();
      shown.unmount();
    }
    shown = undefined;
  });

  it("stops the person with one click, no confirmation", async () => {
    shown = showComposer(answering());

    await act(async () => {
      stopButton(shown as ShownComposer)?.click();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    expect(stopThread).toHaveBeenCalledWith(THREAD_ID);
  });

  it("says why when the stop is refused", async () => {
    vi.mocked(stopThread).mockRejectedValue(new Error("The service is down."));
    shown = showComposer(answering());

    await act(async () => {
      stopButton(shown as ShownComposer)?.click();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    expect(shown.page.textContent).toContain("Jan wasn't stopped");
  });

  it("/stop stops the person as the button does", async () => {
    shown = showComposer(answering());
    shown.type("/stop");

    await shown.send();

    expect(stopThread).toHaveBeenCalledWith(THREAD_ID);
  });

  it("/stop between turns answers that there is nothing to stop and stops nothing", async () => {
    shown = showComposer({ ...answering(), state: "waiting" });
    shown.type("/stop");

    await shown.send();

    expect(stopThread).not.toHaveBeenCalled();
    expect(shown.page.textContent).toContain("Jan isn't answering: nothing to stop.");
  });
});
