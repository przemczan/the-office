import { describe, expect, it } from "vitest";
import {
  decisionWaiting,
  engineDown,
  gateWaiting,
  handles,
  notificationOf,
  samePointer,
  taskDone,
  taskFailed,
  taskPaused,
  windowMove,
  windowNearlyUsed,
  windowReset,
  type NotificationDraft,
} from "./notification.js";

const AT = new Date("2026-10-27T09:00:00Z");

function raised(draft: NotificationDraft) {
  return notificationOf(draft, "n1", AT);
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
        windowNearlyUsed(90, undefined),
        windowReset(undefined),
        engineDown("Claude Code didn't start.", undefined),
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
      ["office.window-nearly-used", null, "90% of the 5-hour window is used."],
      ["office.window-reset", null, "The 5-hour window reset."],
      ["office.engine-down", null, "The engine is down: Claude Code didn't start."],
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
      pointsTo: { kind: "task", taskId: "t1" },
    });
  });

  it("speaks of the 5-hour window with no person while no Office Manager is hired", () => {
    expect(raised(windowNearlyUsed(91.6, undefined))).toMatchObject({
      roleKey: undefined,
      line: "92% of the 5-hour window is used.",
      pointsTo: { kind: "office" },
      channels: ["in-app"],
    });
  });

  it("gives the Office kinds the Office Manager's first person once one is hired", () => {
    expect(
      [
        windowNearlyUsed(91.6, "office-manager"),
        windowReset("office-manager"),
        engineDown("Claude Code didn't start.", "office-manager"),
      ].map(content),
    ).toEqual([
      ["office.window-nearly-used", "office-manager", "We've used 92% of the 5-hour window."],
      [
        "office.window-reset",
        "office-manager",
        "The 5-hour window reset, so we have all of it again.",
      ],
      [
        "office.engine-down",
        "office-manager",
        "I can't reach the engine: Claude Code didn't start.",
      ],
    ]);
    expect(windowReset("office-manager").pointsTo).toEqual({ kind: "office" });
  });

  it("goes to the channels its kind routes to", () => {
    expect(
      raised(gateWaiting("t1", { key: "look", name: "UI acceptance" }, "developer")),
    ).toMatchObject({
      line: "My work is ready for your look at UI acceptance.",
      channels: ["in-app", "desktop"],
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
});
