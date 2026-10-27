import { describe, expect, it } from "vitest";
import { channelsOf, levelsOf, NOTIFICATION_KINDS } from "./notification-kinds.js";

describe("levelsOf", () => {
  it("is the kind and each level above it, nearest first", () => {
    expect(levelsOf("needs-you.decision.limit-reached")).toEqual([
      "needs-you.decision.limit-reached",
      "needs-you.decision",
      "needs-you",
    ]);
  });
});

describe("channelsOf", () => {
  it("routes by spec 2.7's defaults", () => {
    const routed = Object.fromEntries(NOTIFICATION_KINDS.map((kind) => [kind, channelsOf(kind)]));

    expect(routed).toEqual({
      "needs-you.decision": ["in-app", "desktop"],
      "needs-you.gate": ["in-app", "desktop"],
      "needs-you.message": ["in-app", "desktop"],
      "outcomes.task-done": ["in-app", "desktop"],
      "outcomes.task-failed": ["in-app", "desktop"],
      "outcomes.task-paused": ["in-app", "desktop"],
      "office.window-nearly-used": ["in-app"],
      "office.window-reset": ["in-app"],
      "office.service-down": ["in-app", "desktop"],
      "office.engine-down": ["in-app", "desktop"],
    });
  });

  it("takes each channel from the nearest level that sets it", () => {
    const routing = {
      outcomes: { "in-app": true, desktop: true },
      "outcomes.task-done": { desktop: false },
    };

    expect(channelsOf("outcomes.task-done", routing)).toEqual(["in-app"]);
    expect(channelsOf("outcomes.task-failed", routing)).toEqual(["in-app", "desktop"]);
  });

  it("keeps a kind's override for the kinds split below it", () => {
    const routing = {
      "needs-you": { "in-app": true, desktop: true },
      "needs-you.decision": { desktop: false },
    };

    expect(channelsOf("needs-you.decision.limit-reached", routing)).toEqual(["in-app"]);
    expect(channelsOf("needs-you.gate", routing)).toEqual(["in-app", "desktop"]);
  });

  it("leaves a channel no level sets off", () => {
    expect(channelsOf("unknown.kind", {})).toEqual([]);
  });
});
