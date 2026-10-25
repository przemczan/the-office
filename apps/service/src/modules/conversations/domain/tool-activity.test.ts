import { describe, expect, it } from "vitest";
import { toolActivitySummary } from "./tool-activity.js";

describe("a tool call's line in the log", () => {
  it("names the file, pattern, command, address or query the call was about", () => {
    expect(toolActivitySummary({ file_path: "/bases/admin/README.md" })).toBe(
      "/bases/admin/README.md",
    );
    expect(toolActivitySummary({ pattern: "deploy", path: "/bases/admin" })).toBe("deploy");
    expect(toolActivitySummary({ command: "git log\n  --oneline -5" })).toBe(
      "git log --oneline -5",
    );
    expect(toolActivitySummary({ url: "https://example.com", prompt: "Summarize" })).toBe(
      "https://example.com",
    );
  });

  it("is empty for a call with nothing to name, and cut when long", () => {
    expect(toolActivitySummary({ todos: [] })).toBe("");
    expect(toolActivitySummary(undefined)).toBe("");
    expect(toolActivitySummary({ command: "x".repeat(300) })).toHaveLength(200);
  });
});
