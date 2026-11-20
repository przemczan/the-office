import { describe, expect, it } from "vitest";
import { checksOf, type CheckRunOnGitHub } from "./pull-request-status.js";
import { missingPermissions, REQUIRED_PERMISSIONS } from "./github-app.js";

function verdictOfRun(run: CheckRunOnGitHub) {
  return checksOf({ kind: "read", runs: [run], statuses: [] });
}

describe("a check run's verdict", () => {
  it.each(["failure", "timed_out", "cancelled", "action_required", "startup_failure"])(
    "fails on a completed run concluding %s",
    (conclusion) => {
      expect(verdictOfRun({ status: "completed", conclusion })).toBe("failing");
    },
  );

  it.each(["success", "neutral", "skipped"])("passes on %s", (conclusion) => {
    expect(verdictOfRun({ status: "completed", conclusion })).toBe("passing");
  });

  it.each([
    { status: "queued", conclusion: null },
    { status: "in_progress", conclusion: null },
    { status: "waiting", conclusion: null },
    { status: "requested", conclusion: null },
    // A run GitHub ended as stale never concluded; a conclusion it may add isn't taken as a pass.
    { status: "completed", conclusion: "stale" },
    { status: "completed", conclusion: "something-new" },
    { status: "completed", conclusion: null },
  ])("is pending for $status, $conclusion", (run) => {
    expect(verdictOfRun(run)).toBe("pending");
  });
});

describe("a commit status' verdict", () => {
  it.each([
    ["failure", "failing"],
    ["error", "failing"],
    ["pending", "pending"],
    ["success", "passing"],
  ])("takes %s as %s", (state, verdict) => {
    expect(checksOf({ kind: "read", runs: [], statuses: [{ state }] })).toBe(verdict);
  });

  it("fails on a failing status beside passing check runs", () => {
    expect(
      checksOf({
        kind: "read",
        runs: [{ status: "completed", conclusion: "success" }],
        statuses: [{ state: "error" }],
      }),
    ).toBe("failing");
  });
});

describe("the permissions an installation lacks", () => {
  it("is none when every one is granted, a higher level satisfying a lower", () => {
    const granted = Object.fromEntries(
      Object.keys(REQUIRED_PERMISSIONS).map((name) => [name, "admin"]),
    );
    expect(missingPermissions(granted)).toEqual([]);
  });

  it("names a permission granted below its level, left out, or at a level unknown", () => {
    expect(
      missingPermissions({
        metadata: "read",
        contents: "read",
        pull_requests: "write",
        workflows: "write",
        checks: "write",
        statuses: "unheard-of",
        actions: "write",
        issues: "write",
      }),
    ).toEqual([
      { name: "contents", level: "write" },
      { name: "statuses", level: "read" },
    ]);
  });
});
