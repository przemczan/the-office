import type { Thread } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import { threadTitle } from "./thread-title.ts";

function aThread(fields: Partial<Thread>): Thread {
  return {
    id: "0b4cbb0e-5a51-4a52-9a4e-7c0f3c1b9f10",
    home: { kind: "task", taskId: "6f1c2c0e-2f0a-4f39-9a49-5d8b0c1e2a33" },
    roleKey: "planner",
    title: "Planning",
    state: "waiting",
    tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
    context: {
      move: "fresh",
      reason: "new-thread",
      cacheWarm: false,
      cacheWarmUntil: null,
      contextTokens: 0,
      contextWindow: null,
      contextReported: true,
      briefTokens: 3_000,
      alternatives: [],
      override: null,
    },
    startedAt: "2026-10-26T09:00:00.000Z",
    stageThread: false,
    consultation: null,
    changesAllowed: null,
    skillCommands: [],
    answered: null,
    lastMovedAt: null,
    ...fields,
  };
}

describe("threadTitle", () => {
  it("shows a Task's Thread with its person", () => {
    expect(threadTitle(aThread({}), "Jan")).toBe("Planning · Jan");
    expect(threadTitle(aThread({ title: null }), "Jan")).toBe("With Jan");
  });

  it("shows a chat's Thread by its title alone, as the chat is with one person", () => {
    const home = { kind: "chat", roleKey: "planner" } as const;

    expect(threadTitle(aThread({ home, title: "Deploys" }), "Jan")).toBe("Deploys");
    expect(threadTitle(aThread({ home, title: null }), "Jan")).toBe("New thread");
  });
});
