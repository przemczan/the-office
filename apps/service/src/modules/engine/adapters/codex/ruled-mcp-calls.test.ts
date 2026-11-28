import { describe, expect, it } from "vitest";
import { RuledMcpCalls } from "./ruled-mcp-calls.js";

describe("RuledMcpCalls", () => {
  it("takes a call once for each time the rules allowed it, whatever the order of its keys", () => {
    const ruled = new RuledMcpCalls();
    ruled.allow("github", "list_issues", { state: "open", labels: ["bug"] });
    ruled.allow("github", "list_issues", { state: "open", labels: ["bug"] });

    expect(ruled.take("github", "list_issues", { labels: ["bug"], state: "open" })).toBe(true);
    expect(ruled.take("github", "list_issues", { state: "open", labels: ["bug"] })).toBe(true);
    expect(ruled.take("github", "list_issues", { state: "open", labels: ["bug"] })).toBe(false);
  });

  it("takes no call of another server, tool or arguments", () => {
    const ruled = new RuledMcpCalls();
    ruled.allow("github", "list_issues", {});

    expect(ruled.take("gitlab", "list_issues", {})).toBe(false);
    expect(ruled.take("github", "delete_repo", {})).toBe(false);
    expect(ruled.take("github", "list_issues", { state: "open" })).toBe(false);
    expect(ruled.take("github", "list_issues", undefined)).toBe(true);
  });
});
