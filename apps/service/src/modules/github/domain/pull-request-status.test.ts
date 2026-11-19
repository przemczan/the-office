import { describe, expect, it } from "vitest";
import { checksOf, mergeableOf, pullRequestStateOf } from "./pull-request-status.js";

const passed = { status: "completed", conclusion: "success" };
const failed = { status: "completed", conclusion: "failure" };
const running = { status: "in_progress", conclusion: null };

describe("a pull request's checks in one word", () => {
  it("is failing when any check fails, even with others pending", () => {
    expect(checksOf({ kind: "read", runs: [passed, running, failed], statuses: [] })).toBe(
      "failing",
    );
  });

  it("is pending while any check runs and none failed", () => {
    expect(
      checksOf({ kind: "read", runs: [passed, running], statuses: [{ state: "success" }] }),
    ).toBe("pending");
  });

  it("is passing when every check run and status passed", () => {
    expect(checksOf({ kind: "read", runs: [passed], statuses: [{ state: "success" }] })).toBe(
      "passing",
    );
  });

  it("is none without check runs or statuses, and unknown when GitHub won't show them", () => {
    expect(checksOf({ kind: "read", runs: [], statuses: [] })).toBe("none");
    expect(checksOf({ kind: "unreadable" })).toBe("unknown");
  });
});

describe("a pull request's state and mergeability", () => {
  it("tells merged from closed by merged_at", () => {
    expect(pullRequestStateOf("open", null)).toBe("open");
    expect(pullRequestStateOf("closed", "2026-11-19T10:00:00Z")).toBe("merged");
    expect(pullRequestStateOf("closed", null)).toBe("closed");
  });

  it("is unknown while GitHub works out whether it merges", () => {
    expect(mergeableOf(true)).toBe("yes");
    expect(mergeableOf(false)).toBe("conflicts");
    expect(mergeableOf(null)).toBe("unknown");
  });
});
