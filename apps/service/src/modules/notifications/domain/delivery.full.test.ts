import { describe, expect, it } from "vitest";
import {
  collapsedOutcomes,
  deliveryOf,
  emptiedGatherings,
  isOutcome,
  outcomeToJoin,
  outcomesLine,
  phoneDeliveryOf,
  quietHoursSummary,
  receivedBy,
  shownOf,
  withQuietHours,
} from "./delivery.js";
import { DEFAULT_TIMING, type NotificationTiming } from "./notification-timing.js";
import type { Notification, ReceivedNotification } from "./notification.js";

/** On the service's local clock, as quiet hours are. */
const at = (hours: number, minutes = 0): Date => new Date(2026, 9, 29, hours, minutes);

function notification(
  overrides: Partial<ReceivedNotification> & Pick<ReceivedNotification, "id">,
): ReceivedNotification {
  return {
    kind: "needs-you.decision",
    roleKey: undefined,
    line: "I need your answer: Keep the query string?",
    shortLine: undefined,
    at: undefined,
    pointsTo: { kind: "office" },
    channels: ["in-app", "desktop", "phone"],
    raisedAt: at(12),
    gathers: [],
    forUser: undefined,
    held: [],
    phonePushedAt: undefined,
    ...overrides,
  };
}

const away = (minutesAgo: number): { lastActiveAt: Date; leftAt: Date } => ({
  lastActiveAt: new Date(at(12).getTime() - minutesAgo * 60_000),
  leftAt: at(9),
});

const done = (id: string, raisedAt: Date): ReceivedNotification =>
  notification({ id, kind: "outcomes.task-done", channels: ["in-app", "desktop"], raisedAt });

const QUIET: NotificationTiming = { ...DEFAULT_TIMING, quietHours: { from: "22:00", to: "07:00" } };

describe("quiet hours", () => {
  it("hold the desktop and the phone, never in-app", () => {
    expect(withQuietHours(notification({ id: "n1" }), QUIET, at(23)).held).toEqual([
      "desktop",
      "phone",
    ]);
    expect(withQuietHours(notification({ id: "n1" }), QUIET, at(12)).held).toEqual([]);
  });

  it("let the service or an Agent engine down through", () => {
    const down = notification({ id: "n1", kind: "office.down.engine" });

    expect(withQuietHours(down, QUIET, at(23)).held).toEqual([]);
    expect(phoneDeliveryOf(down, QUIET, undefined, at(23))).toEqual({ kind: "now" });
  });

  it("end in one summary of what they held still open, sent where it was held from", () => {
    const outcome = notification({
      id: "o1",
      kind: "outcomes.task-done",
      channels: ["in-app", "desktop"],
      held: ["desktop"],
    });
    const open = [
      notification({ id: "n1", held: ["desktop", "phone"] }),
      notification({ id: "n2", held: ["desktop", "phone"] }),
      outcome,
      notification({ id: "o2", kind: "outcomes.task-done", held: ["desktop"] }),
      { ...collapsedOutcomes([outcome], "u1", "c1", at(1)), held: ["desktop" as const] },
      notification({ id: "n3", kind: "office.window.reset", channels: ["in-app"] }),
    ];

    expect(quietHoursSummary(open, "u1", "s1", at(7))).toMatchObject({
      kind: "quiet-hours-summary",
      line: "During quiet hours: 2 need you, 2 Outcomes.",
      pointsTo: { kind: "since-you-left" },
      channels: ["desktop", "phone"],
      gathers: ["n1", "n2", "o2", "o1"],
      forUser: "u1",
    });
    expect(quietHoursSummary([open[5] as ReceivedNotification], "u1", "s1", at(7))).toBeUndefined();
  });
});

describe("the phone", () => {
  it("waits while the user is at the desk, then the away delay after the hold ends", () => {
    expect(phoneDeliveryOf(notification({ id: "n1" }), DEFAULT_TIMING, away(2), at(12))).toEqual({
      kind: "wait",
      until: at(12, 8),
    });
  });

  it("goes at once once the user has been away long enough, or was never seen", () => {
    const n1 = notification({ id: "n1" });

    expect(phoneDeliveryOf(n1, DEFAULT_TIMING, away(10), at(12))).toEqual({ kind: "now" });
    expect(phoneDeliveryOf(n1, DEFAULT_TIMING, undefined, at(12))).toEqual({ kind: "now" });
  });

  it("is held inside quiet hours, and goes nowhere it isn't routed or once it went", () => {
    expect(phoneDeliveryOf(notification({ id: "n1" }), QUIET, undefined, at(23))).toEqual({
      kind: "held",
    });
    for (const notRouted of [
      notification({ id: "n1", channels: ["in-app", "desktop"] }),
      notification({ id: "n1", held: ["phone"] }),
      notification({ id: "n1", phonePushedAt: at(11) }),
    ]) {
      expect(phoneDeliveryOf(notRouted, DEFAULT_TIMING, undefined, at(12))).toEqual({
        kind: "none",
      });
    }
  });
});

describe("batching", () => {
  it("joins an Outcome to the latest one shown within the window; Needs you is never batched", () => {
    const shown = [
      done("o1", at(12)),
      done("o2", at(12, 1)),
      notification({ id: "n1", raisedAt: at(12, 2) }),
    ];

    expect(outcomeToJoin(shown, DEFAULT_TIMING, at(12, 2))?.id).toBe("o2");
    expect(outcomeToJoin(shown, DEFAULT_TIMING, at(12, 3))).toBeUndefined();
  });

  it("never batches a test instance's Outcome, neither joining one nor joined", () => {
    const running = notification({
      id: "t1",
      kind: "outcomes.test-instance.running",
      pointsTo: { kind: "test-instance", instanceId: "i1", projectId: "the-office" },
      raisedAt: at(12, 1),
    });

    expect(isOutcome(running)).toBe(false);
    expect(isOutcome(done("o1", at(12)))).toBe(true);
    expect(outcomeToJoin([done("o1", at(12, 1)), running], DEFAULT_TIMING, at(12, 2))?.id).toBe(
      "o1",
    );
    expect(outcomeToJoin([running], DEFAULT_TIMING, at(12, 2))).toBeUndefined();
  });

  it("counts a test instance's Outcome among the Outcomes quiet hours held", () => {
    const failed = notification({
      id: "t1",
      kind: "outcomes.test-instance.failed",
      channels: ["in-app", "desktop"],
      held: ["desktop"],
    });

    expect(quietHoursSummary([failed], "u1", "s1", at(7))?.line).toBe(
      "During quiet hours: 1 Outcome.",
    );
  });

  it("collapses Outcomes into one in the UI's voice, sent where any of them goes", () => {
    const failed = notification({ id: "o3", kind: "outcomes.task-failed" });

    expect(
      collapsedOutcomes([done("o1", at(12)), done("o2", at(12)), failed], "u1", "c1", at(12)),
    ).toMatchObject({
      forUser: "u1",
      line: "2 Tasks done, 1 Task failed",
      roleKey: undefined,
      pointsTo: { kind: "since-you-left" },
      channels: ["in-app", "desktop", "phone"],
      gathers: ["o1", "o2", "o3"],
    });
    expect(outcomesLine([done("o1", at(12)), done("o2", at(12)), done("o3", at(12))])).toBe(
      "3 Tasks done",
    );
    expect(outcomesLine([notification({ id: "i1", kind: "outcomes.initiative-done" })])).toBe(
      "1 Initiative done",
    );
  });

  it("shows the collapse in place of its Outcomes, and clears it once none of them is open", () => {
    const outcomes = [done("o1", at(12)), done("o2", at(12))];
    const collapsed = collapsedOutcomes(outcomes, "u1", "c1", at(12));

    expect(shownOf([...outcomes, collapsed]).map(({ id }) => id)).toEqual(["c1"]);
    expect(emptiedGatherings([outcomes[0] as Notification, collapsed])).toEqual([]);
    expect(emptiedGatherings([collapsed])).toEqual([collapsed]);
  });

  it("keeps a collapse to its one user: another sees the shared Outcomes under it", () => {
    const outcomes = [done("o1", at(12)), done("o2", at(12))];
    const collapsed = collapsedOutcomes(outcomes, "u1", "c1", at(12));
    const open: Notification[] = [...outcomes, collapsed];
    const deliveries = [
      ...outcomes.map((outcome) => deliveryOf(outcome, "u1")),
      deliveryOf(collapsed, "u1"),
      ...outcomes.map((outcome) => deliveryOf(outcome, "u2")),
    ];

    expect(shownOf(receivedBy("u1", open, deliveries)).map(({ id }) => id)).toEqual(["c1"]);
    expect(shownOf(receivedBy("u2", open, deliveries)).map(({ id }) => id)).toEqual(["o1", "o2"]);
  });
});

describe("each user's delivery", () => {
  it("gives each user the channels of their own delivery, and none without one", () => {
    const shared = notification({ id: "n1" });
    const deliveries = [
      deliveryOf({ ...shared, channels: ["in-app", "desktop", "phone"] }, "u1"),
      deliveryOf({ ...shared, channels: ["in-app"], held: [] }, "u2"),
    ];

    const [forOne] = receivedBy("u1", [shared], deliveries);
    const [forOther] = receivedBy("u2", [shared], deliveries);
    const [forThird] = receivedBy("u3", [shared], deliveries);

    expect(forOne?.channels).toEqual(["in-app", "desktop", "phone"]);
    expect(forOther?.channels).toEqual(["in-app"]);
    expect(forThird).toMatchObject({ id: "n1", channels: [], held: [] });
  });

  it("holds only the user whose quiet hours it is in", () => {
    const shared = notification({ id: "n1" });

    expect(withQuietHours(shared, QUIET, at(23)).held).toEqual(["desktop", "phone"]);
    expect(withQuietHours(shared, DEFAULT_TIMING, at(23)).held).toEqual([]);
  });

  it("waits the phone only on its own user's activity", () => {
    const shared = notification({ id: "n1" });

    expect(phoneDeliveryOf(shared, DEFAULT_TIMING, away(2), at(12)).kind).toBe("wait");
    expect(phoneDeliveryOf(shared, DEFAULT_TIMING, undefined, at(12)).kind).toBe("now");
  });
});
