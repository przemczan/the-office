import { describe, expect, it } from "vitest";
import {
  channelsOf,
  DEFAULT_ROUTING,
  levelsOf,
  NOTIFICATION_KINDS,
  ROUTING_LEVELS,
  routedChannel,
  withChannelSet,
  withLevelReset,
} from "./notification-kinds.js";

describe("levelsOf", () => {
  it("is the kind and each level above it, nearest first", () => {
    expect(levelsOf("needs-you.decision.limit-reached")).toEqual([
      "needs-you.decision.limit-reached",
      "needs-you.decision",
      "needs-you",
    ]);
  });
});

describe("ROUTING_LEVELS", () => {
  it("is each group, then its kinds and the levels between, as the grid's rows", () => {
    expect(ROUTING_LEVELS).toEqual([
      "needs-you",
      "needs-you.decision",
      "needs-you.gate",
      "needs-you.message",
      "outcomes",
      "outcomes.task-done",
      "outcomes.task-failed",
      "outcomes.task-paused",
      "outcomes.initiative-done",
      "office",
      "office.window",
      "office.window.nearly-used",
      "office.window.reset",
      "office.down",
      "office.down.service",
      "office.down.engine",
      "office.alarm-lifted",
      "office.update",
      "office.update.done",
      "office.update.failed",
    ]);
  });
});

describe("channelsOf", () => {
  it("routes by ticket 20's defaults", () => {
    const routed = Object.fromEntries(
      NOTIFICATION_KINDS.map((kind) => [kind, channelsOf(kind, DEFAULT_ROUTING)]),
    );

    expect(routed).toEqual({
      "needs-you.decision": ["in-app", "desktop", "phone"],
      "needs-you.gate": ["in-app", "desktop", "phone"],
      "needs-you.message": ["in-app", "desktop", "phone"],
      "outcomes.task-done": ["in-app", "desktop"],
      "outcomes.task-failed": ["in-app", "desktop", "phone"],
      "outcomes.task-paused": ["in-app", "desktop", "phone"],
      "outcomes.initiative-done": ["in-app", "desktop"],
      "office.window.nearly-used": ["in-app"],
      "office.window.reset": ["in-app"],
      "office.down.service": ["in-app", "desktop", "phone"],
      "office.down.engine": ["in-app", "desktop", "phone"],
      "office.alarm-lifted": ["in-app"],
      "office.update.done": ["in-app"],
      "office.update.failed": ["in-app"],
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

describe("routedChannel", () => {
  it("names the level a channel is set at, or none", () => {
    expect(routedChannel("office.down.engine", "phone", DEFAULT_ROUTING)).toEqual({
      on: true,
      from: "office.down",
    });
    expect(routedChannel("office", "desktop", DEFAULT_ROUTING)).toEqual({
      on: false,
      from: "office",
    });
    expect(routedChannel("office", "phone", {})).toEqual({ on: false, from: undefined });
  });
});

describe("withChannelSet", () => {
  it("sets a channel at a kind, apart from its group", () => {
    const routing = withChannelSet(DEFAULT_ROUTING, "outcomes.task-done", "phone", true);

    expect(routing["outcomes.task-done"]).toEqual({ phone: true });
    expect(channelsOf("outcomes.initiative-done", routing)).toEqual(["in-app", "desktop"]);
  });

  it("drops a setting that matches the level above, so the kind inherits again", () => {
    const routing = withChannelSet(DEFAULT_ROUTING, "outcomes.task-failed", "phone", false);

    expect(routing).not.toHaveProperty("outcomes.task-failed");
    expect(withChannelSet(DEFAULT_ROUTING, "office.down", "phone", false)["office.down"]).toEqual({
      desktop: true,
    });
  });

  it("keeps a group's setting, which has nothing above to inherit from", () => {
    expect(withChannelSet(DEFAULT_ROUTING, "office", "phone", false).office).toEqual({
      "in-app": true,
      desktop: false,
      phone: false,
    });
  });

  it("reaches the kinds below a group that set nothing of their own", () => {
    const routing = withChannelSet(DEFAULT_ROUTING, "outcomes", "phone", true);

    expect(channelsOf("outcomes.task-done", routing)).toEqual(["in-app", "desktop", "phone"]);
  });
});

describe("withLevelReset", () => {
  it("gives every channel of a kind back to its group", () => {
    const routing = withLevelReset(DEFAULT_ROUTING, "outcomes.task-paused");

    expect(routing).not.toHaveProperty("outcomes.task-paused");
    expect(channelsOf("outcomes.task-paused", routing)).toEqual(["in-app", "desktop"]);
  });
});
