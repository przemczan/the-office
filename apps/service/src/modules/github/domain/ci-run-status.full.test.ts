import { describe, expect, it } from "vitest";
import { ciRunStatusOf, type GitHubCiRunStatus } from "./ci-run-status.js";

describe("ciRunStatusOf, the whole table", () => {
  const notCompleted: [string, GitHubCiRunStatus][] = [
    ["queued", "queued"],
    ["requested", "queued"],
    ["pending", "queued"],
    ["waiting", "waiting"],
    ["in_progress", "running"],
  ];
  it.each(notCompleted)("status %s is %s whatever the conclusion", (status, expected) => {
    expect(ciRunStatusOf(status, null)).toBe(expected);
    expect(ciRunStatusOf(status, "success")).toBe(expected);
  });

  const completed: [string, GitHubCiRunStatus][] = [
    ["success", "succeeded"],
    ["neutral", "succeeded"],
    ["failure", "failed"],
    ["timed_out", "failed"],
    ["startup_failure", "failed"],
    ["action_required", "failed"],
    ["cancelled", "cancelled"],
    ["skipped", "skipped"],
    ["stale", "skipped"],
    ["something_new", "unknown"],
  ];
  it.each(completed)("completed with %s is %s", (conclusion, expected) => {
    expect(ciRunStatusOf("completed", conclusion)).toBe(expected);
  });

  it("is unknown for no status", () => {
    expect(ciRunStatusOf(null, null)).toBe("unknown");
  });
});
