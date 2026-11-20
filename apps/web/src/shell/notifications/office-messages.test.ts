import type { Notification } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import { officeMessageKey, officeMessages, officeMessageWords } from "./office-messages.ts";

const notification = (
  id: string,
  kind: Notification["kind"],
  line: string,
  shortLine?: string,
): Notification => ({
  id,
  kind,
  roleKey: null,
  line,
  ...(shortLine && { shortLine }),
  pointsTo: { kind: "office" },
  channels: ["in-app"],
  held: [],
  raisedAt: "2026-11-14T09:00:00.000Z",
});

const RESET = notification("n1", "office.window.reset", "Claude's 5-hour window reset.", "R");
const DONE = notification("n2", "outcomes.task-done", "Done.");
const DOWN = notification("n3", "office.down.engine", "Claude is down: refused.", "Claude is down");

const NOTHING = {
  reconnecting: false,
  notifications: [],
  scheduled: undefined,
  desktopAsk: false,
};

describe("officeMessages", () => {
  it("is none while The Office has nothing to tell, so the slot is gone", () => {
    expect(officeMessages(NOTHING)).toBeUndefined();
    expect(officeMessages({ ...NOTHING, notifications: [DONE] })).toBeUndefined();
  });

  it("orders reconnecting, the Office's Notifications newest first, the update, then the ask", () => {
    const messages = officeMessages({
      reconnecting: true,
      notifications: [RESET, DONE, DOWN],
      scheduled: { kind: "update", waitingFor: 2 },
      desktopAsk: true,
    });

    expect(messages?.all.map(officeMessageKey)).toEqual([
      "reconnecting",
      "n3",
      "n1",
      "update-scheduled",
      "desktop-ask",
    ]);
    expect(messages?.first).toEqual({ kind: "reconnecting" });
    expect(messages?.more).toBe(4);
  });

  it("counts no more than the first when it is alone", () => {
    const messages = officeMessages({ ...NOTHING, scheduled: { kind: "update", waitingFor: 0 } });

    expect(messages?.first).toEqual({ kind: "update-scheduled", waitingFor: 0 });
    expect(messages?.more).toBe(0);
  });

  it("shows the newest Office Notification first while the web is connected", () => {
    const messages = officeMessages({ ...NOTHING, notifications: [RESET, DOWN], desktopAsk: true });

    expect(messages?.first).toEqual({ kind: "notification", notification: DOWN });
    expect(messages?.more).toBe(2);
  });
});

describe("officeMessageWords", () => {
  it("shows a Notification by its short line, in its kind's tone", () => {
    expect(officeMessageWords({ kind: "notification", notification: DOWN })).toMatchObject({
      shortLine: "Claude is down",
      line: "Claude is down: refused.",
      tone: "danger",
    });
  });

  it("shows a Notification raised before short lines by its whole line", () => {
    const older = notification("n4", "office.window.nearly-used", "We've used 91% of it.");

    expect(officeMessageWords({ kind: "notification", notification: older })).toMatchObject({
      shortLine: "We've used 91% of it.",
      tone: "warning",
    });
  });

  it("says what a scheduled update waits for", () => {
    expect(officeMessageWords({ kind: "update-scheduled", waitingFor: 1 })).toMatchObject({
      shortLine: "Update scheduled",
      detail: "Waiting for 1 thing",
      tone: "info",
    });
    expect(officeMessageWords({ kind: "update-scheduled", waitingFor: 0 }).detail).toBeUndefined();
  });

  it("says what a scheduled restart waits for", () => {
    expect(
      officeMessages({ ...NOTHING, scheduled: { kind: "restart", waitingFor: 2 } })?.first,
    ).toEqual({ kind: "restart-scheduled", waitingFor: 2 });
    expect(officeMessageWords({ kind: "restart-scheduled", waitingFor: 2 })).toMatchObject({
      shortLine: "Restart scheduled",
      line: "A restart of The Office is scheduled, waiting for 2 things to finish.",
      detail: "Waiting for 2 things",
      tone: "info",
    });
  });
});

describe("officeMessageWords of a Notification naming a time", () => {
  it("words the time in the browser's time zone in both the short line and the line", () => {
    const at = "2026-11-17T16:10:00.000Z";
    const usedUp: Notification = {
      ...notification(
        "n4",
        "office.window.used-up",
        "Claude's 5-hour window is used up until {time}.",
        "Claude used up until {time}",
      ),
      at,
    };
    const local = new Date(at);
    const clock = `${String(local.getHours()).padStart(2, "0")}:${String(local.getMinutes()).padStart(2, "0")}`;

    expect(officeMessageWords({ kind: "notification", notification: usedUp }, local)).toMatchObject(
      {
        shortLine: `Claude used up until ${clock}`,
        line: `Claude's 5-hour window is used up until ${clock}.`,
      },
    );
  });
});
