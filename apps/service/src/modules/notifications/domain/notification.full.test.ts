import { describe, expect, it } from "vitest";
import { DEFAULT_ROUTING } from "./notification-kinds.js";
import {
  decisionWaiting,
  engineDown,
  gateWaiting,
  handles,
  notificationOf,
  officeUpdated,
  officeUpdateFailed,
  samePointer,
  taskDone,
  taskFailed,
  taskPaused,
  windowMove,
  windowNearlyUsed,
  windowReset,
  windowUsedUp,
  type NotificationDraft,
} from "./notification.js";

const CLAUDE_CODE = { id: "claude-code", name: "Claude Code" };
const WORK_ACCOUNT = { id: "work-account", name: "Work account" };

const AT = new Date("2026-10-27T09:00:00Z");

function raised(draft: NotificationDraft) {
  return notificationOf(draft, "n1", AT, DEFAULT_ROUTING);
}

/** What a Notification says: its kind, who speaks (null for The Office), and its line. */
function content(draft: NotificationDraft): (string | null)[] {
  return [draft.kind, draft.roleKey ?? null, draft.line];
}

describe("the Notifications' content", () => {
  it("gives each kind the person who speaks and one line, and The Office's kinds the UI's voice", () => {
    const question = { id: "d1", taskId: "t1", question: "Keep the query string?" };

    expect(
      [
        decisionWaiting({ ...question, roleKey: "developer" }),
        gateWaiting("t1", { key: "look", name: "Look" }, "developer"),
        taskDone("t1", "developer"),
        taskFailed("t1", "developer", { kind: "definition-of-done" }),
        taskPaused("t1", "developer", "pause"),
        taskPaused("t1", "developer", "stop"),
        windowNearlyUsed(CLAUDE_CODE, 90, undefined),
        windowReset(CLAUDE_CODE, undefined),
        engineDown(CLAUDE_CODE, "Claude Code didn't start.", undefined),
      ].map(content),
    ).toEqual([
      ["needs-you.decision", "developer", "I need your answer: Keep the query string?"],
      ["needs-you.gate", "developer", "My work is ready for your look at Look."],
      ["outcomes.task-done", "developer", "I finished the Task."],
      [
        "outcomes.task-failed",
        "developer",
        "I ran every Stage, but the Definition of Done isn't met.",
      ],
      ["outcomes.task-paused", "developer", "I paused at a safe point."],
      ["outcomes.task-paused", "developer", "I stopped where I was."],
      ["office.window.nearly-used", null, "90% of Claude Code's 5-hour window is used."],
      ["office.window.reset", null, "Claude Code's 5-hour window reset."],
      ["office.down.engine", null, "Claude Code is down: Claude Code didn't start."],
    ]);
  });

  it("speaks in the UI's voice when the Task has no person yet", () => {
    expect([taskDone("t1", undefined).line, taskPaused("t1", undefined, "stop").line]).toEqual([
      "Done.",
      "Stopped.",
    ]);
  });

  it("lets the asker speak in the first person, and The Office in the UI's voice", () => {
    const question = { id: "d1", taskId: "t1", question: "Keep the query string?" };

    expect(decisionWaiting({ ...question, roleKey: "developer" })).toMatchObject({
      roleKey: "developer",
      line: "I need your answer: Keep the query string?",
    });
    expect(decisionWaiting({ ...question, roleKey: undefined })).toMatchObject({
      roleKey: undefined,
      line: "Keep the query string?",
    });
  });

  it("names the Stage that failed for good, and points at the Task", () => {
    expect(taskFailed("t1", "developer", { kind: "no-retries-left", stageName: "Tests" })).toEqual({
      kind: "outcomes.task-failed",
      roleKey: "developer",
      line: "Tests failed and I have no retries left.",
      shortLine: undefined,
      pointsTo: { kind: "task", taskId: "t1" },
    });
  });

  it("speaks of an engine's 5-hour window with no person while no Office Manager is hired", () => {
    expect(raised(windowNearlyUsed(WORK_ACCOUNT, 91.6, undefined))).toMatchObject({
      roleKey: undefined,
      line: "92% of Work account's 5-hour window is used.",
      pointsTo: { kind: "office", engineId: "work-account" },
      channels: ["in-app"],
    });
  });

  it("gives the Office kinds the Office Manager's first person once one is hired", () => {
    expect(
      [
        windowNearlyUsed(CLAUDE_CODE, 91.6, "office-manager"),
        windowReset(CLAUDE_CODE, "office-manager"),
        engineDown(CLAUDE_CODE, "Claude Code didn't start.", "office-manager"),
      ].map(content),
    ).toEqual([
      [
        "office.window.nearly-used",
        "office-manager",
        "We've used 92% of Claude Code's 5-hour window.",
      ],
      [
        "office.window.reset",
        "office-manager",
        "Claude Code's 5-hour window reset, so we have all of it again.",
      ],
      [
        "office.down.engine",
        "office-manager",
        "I can't reach Claude Code: Claude Code didn't start.",
      ],
    ]);
    expect(windowReset(CLAUDE_CODE, "office-manager").pointsTo).toEqual({
      kind: "office",
      engineId: "claude-code",
    });
  });

  it("gives the Office kinds a short line in nobody's voice, whoever speaks, and others none", () => {
    const usedUp = { window: "5-hour window", resetsAt: new Date(2026, 9, 27, 14, 20) };
    const shortLines = (officeManager: string | undefined) =>
      [
        windowNearlyUsed(CLAUDE_CODE, 91.4, officeManager),
        windowReset(CLAUDE_CODE, officeManager),
        windowUsedUp(CLAUDE_CODE, usedUp, officeManager, new Date(2026, 9, 27, 12, 0)),
        engineDown(WORK_ACCOUNT, "connection refused", officeManager),
        officeUpdated("1.8.0", officeManager),
        officeUpdateFailed("install", "1.7.2", officeManager),
      ].map(({ shortLine }) => shortLine);

    const expected = [
      "Claude Code: 91% of 5-hour window",
      "Claude Code's window reset",
      "Claude Code used up until 14:20",
      "Work account is down",
      "Updated to 1.8.0",
      "Update failed, back on 1.7.2",
    ];
    expect(shortLines("office-manager")).toEqual(expected);
    expect(shortLines(undefined)).toEqual(expected);
    expect(taskDone("t1", "developer").shortLine).toBeUndefined();
  });

  it("goes to the channels its kind routes to", () => {
    expect(
      raised(gateWaiting("t1", { key: "look", name: "UI acceptance" }, "developer")),
    ).toMatchObject({
      line: "My work is ready for your look at UI acceptance.",
      channels: ["in-app", "desktop", "phone"],
    });
  });
});

describe("handles", () => {
  const decision = raised(
    decisionWaiting({ id: "d1", taskId: "t1", roleKey: undefined, question: "Raise the budget?" }),
  );
  const failed = raised(taskFailed("t1", undefined, { kind: "definition-of-done" }));
  const paused = raised(taskPaused("t1", undefined, "pause"));
  const gate = raised(gateWaiting("t1", { key: "look", name: "Look" }, undefined));

  it("clears a Decision and the failure it was about once the Decision is answered", () => {
    const answered = { kind: "decision-answered", decisionId: "d1", taskId: "t1" } as const;

    expect([decision, failed, paused, gate].map((one) => handles(answered, one))).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });

  it("clears a Task's outcomes when the user opens the Task, and a pause when it resumes", () => {
    expect(handles({ kind: "task-opened", taskId: "t1" }, failed)).toBe(true);
    expect(handles({ kind: "task-opened", taskId: "t2" }, failed)).toBe(false);
    expect(handles({ kind: "task-resumed", taskId: "t1" }, paused)).toBe(true);
    expect(handles({ kind: "task-opened", taskId: "t1" }, decision)).toBe(false);
  });

  it("clears a Gate once the user acts at it", () => {
    expect(handles({ kind: "gate-acted", taskId: "t1" }, gate)).toBe(true);
  });

  it("clears an engine down once that engine answers again", () => {
    const down = raised(engineDown(CLAUDE_CODE, "Signed out.", undefined));
    const unnamed = { ...down, pointsTo: { kind: "office" } as const };

    expect(handles({ kind: "engine-answered", engineId: "claude-code" }, down)).toBe(true);
    expect(handles({ kind: "engine-answered", engineId: "work-account" }, down)).toBe(false);
    expect(handles({ kind: "engine-answered", engineId: "work-account" }, unnamed)).toBe(true);
  });

  it("clears every Notification about an engine once it is removed, and only those", () => {
    const down = raised(engineDown(CLAUDE_CODE, "Signed out.", undefined));
    const nearlyUsed = raised(windowNearlyUsed(CLAUDE_CODE, 92, undefined));
    const unnamed = { ...down, pointsTo: { kind: "office" } as const };

    expect(handles({ kind: "engine-removed", engineId: "claude-code" }, down)).toBe(true);
    expect(handles({ kind: "engine-removed", engineId: "claude-code" }, nearlyUsed)).toBe(true);
    expect(handles({ kind: "engine-removed", engineId: "work-account" }, down)).toBe(false);
    expect(handles({ kind: "engine-removed", engineId: "claude-code" }, unnamed)).toBe(false);
  });

  it("clears only that engine's nearly used window when its window resets, and every one on Now", () => {
    const nearlyUsed = raised(windowNearlyUsed(CLAUDE_CODE, 92, undefined));
    const unnamed = { ...nearlyUsed, pointsTo: { kind: "office" } as const };

    expect(handles({ kind: "window-reset", engineId: "claude-code" }, nearlyUsed)).toBe(true);
    expect(handles({ kind: "window-reset", engineId: "work-account" }, nearlyUsed)).toBe(false);
    expect(handles({ kind: "window-reset", engineId: "work-account" }, unnamed)).toBe(true);
    expect(handles({ kind: "now-opened" }, nearlyUsed)).toBe(true);
  });
});

describe("windowMove", () => {
  it("is nearly used when the window crosses 90%, and reset when it drops", () => {
    expect(windowMove(85, 90)).toBe("nearly-used");
    expect(windowMove(91, 95)).toBeUndefined();
    expect(windowMove(95, 3)).toBe("reset");
    expect(windowMove(20, 40)).toBeUndefined();
  });
});

describe("samePointer", () => {
  it("compares the kind and what it points to, whatever the order of its fields", () => {
    const one = decisionWaiting({ id: "d1", taskId: "t1", roleKey: undefined, question: "?" });
    const reordered = {
      ...one,
      pointsTo: { taskId: "t1", decisionId: "d1", kind: "decision" as const },
    };

    expect(samePointer(one, reordered)).toBe(true);
    expect(samePointer(one, { ...one, kind: "needs-you.gate" })).toBe(false);
  });

  it("keeps each engine's down apart", () => {
    const down = engineDown(CLAUDE_CODE, "Signed out.", undefined);
    const other = engineDown(
      { id: "work-account", name: "Work account" },
      "Signed out.",
      undefined,
    );

    expect(down.pointsTo).toEqual({ kind: "office", engineId: "claude-code" });
    expect(samePointer(down, other)).toBe(false);
    expect(samePointer(down, engineDown(CLAUDE_CODE, "Gone.", "office-manager"))).toBe(true);
  });
});
