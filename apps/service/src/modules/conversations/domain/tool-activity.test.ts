import { describe, expect, it } from "vitest";
import { toolActivitySummary } from "./tool-activity.js";

const FOLDER = "/office/bases";

describe("a tool call's line in the log", () => {
  it("names a path inside the session's folder from there", () => {
    expect(toolActivitySummary({ file_path: "/office/bases/admin-panel/README.md" }, FOLDER)).toBe(
      "admin-panel/README.md",
    );
    expect(
      toolActivitySummary({ file_path: "C:\\office\\bases\\admin\\a.ts" }, "C:\\office\\bases"),
    ).toBe("admin\\a.ts");
  });

  it("names the file, pattern, command, address or query the call was about", () => {
    expect(toolActivitySummary({ file_path: "/elsewhere/README.md" }, FOLDER)).toBe(
      "/elsewhere/README.md",
    );
    expect(toolActivitySummary({ pattern: "deploy", path: "/bases/admin" }, FOLDER)).toBe("deploy");
    expect(toolActivitySummary({ command: "git log --oneline -5" }, FOLDER)).toBe(
      "git log --oneline -5",
    );
    expect(toolActivitySummary({ url: "https://example.com", prompt: "Summarize" }, FOLDER)).toBe(
      "https://example.com",
    );
  });

  it("is empty for a call with nothing to name", () => {
    expect(toolActivitySummary({ todos: [] }, FOLDER)).toBe("");
    expect(toolActivitySummary(undefined, FOLDER)).toBe("");
  });

  it("keeps a command over 200 characters whole", () => {
    const command = `npx vitest run ${"apps/service/src/a.test.ts ".repeat(20)}--reporter=dot`;
    expect(toolActivitySummary({ command }, FOLDER)).toBe(command);
  });

  it("keeps a command's line breaks, leaving out only the space around it", () => {
    const command = "git log \\\n  --oneline -5\n\ngit status";
    expect(toolActivitySummary({ command: `\n  ${command}\n` }, FOLDER)).toBe(command);
  });
});
