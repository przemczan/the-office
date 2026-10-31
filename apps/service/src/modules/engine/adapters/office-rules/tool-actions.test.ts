import { describe, expect, it } from "vitest";
import { agentAction } from "./tool-actions.js";

describe("agentAction", () => {
  it("reads the paths of the file tools", () => {
    expect(agentAction("Read", { file_path: "src/app.ts" })).toEqual({
      kind: "read",
      paths: ["src/app.ts"],
    });
    expect(agentAction("Grep", { pattern: "cart" })).toEqual({ kind: "read", paths: ["."] });
    expect(agentAction("Edit", { file_path: "a.ts", old_string: "", new_string: "" })).toEqual({
      kind: "edit",
      paths: ["a.ts"],
    });
    expect(agentAction("Write", { file_path: "b.ts", content: "" })).toEqual({
      kind: "edit",
      paths: ["b.ts"],
    });
    expect(agentAction("NotebookEdit", { notebook_path: "n.ipynb", new_source: "" })).toEqual({
      kind: "edit",
      paths: ["n.ipynb"],
    });
  });

  it("reads a glob pattern's own folder up to its first wildcard", () => {
    expect(agentAction("Glob", { pattern: "src/**/*.ts" })).toEqual({
      kind: "read",
      paths: [".", "./src"],
    });
    expect(agentAction("Glob", { pattern: "*.md", path: "docs" })).toEqual({
      kind: "read",
      paths: ["docs", "docs/"],
    });
    expect(agentAction("Glob", { pattern: "../../**" })).toEqual({
      kind: "read",
      paths: [".", "./../.."],
    });
    expect(agentAction("Glob", { pattern: "C:/Users/office/.ssh/*" })).toEqual({
      kind: "read",
      paths: [".", "C:/Users/office/.ssh"],
    });
    expect(agentAction("Glob", { pattern: "/etc/**" })).toEqual({
      kind: "read",
      paths: [".", "/etc"],
    });
  });

  it("reads each folder a glob's braces name, and climbs for a .. after a wildcard", () => {
    expect(agentAction("Glob", { pattern: "{src,/etc}/*.conf" })).toEqual({
      kind: "read",
      paths: [".", "./src", "/etc"],
    });
    expect(agentAction("Glob", { pattern: "docs/{a,{b,../../c}}/*" })).toEqual({
      kind: "read",
      paths: [".", "./docs/a", "./docs/b", "./docs/../../c"],
    });
    expect(agentAction("Glob", { pattern: "src/*/../../../*" })).toEqual({
      kind: "read",
      paths: [".", "./src/../../.."],
    });
    expect(agentAction("Glob", { pattern: "{*.md" })).toEqual({ kind: "read", paths: [".", "./"] });
  });

  it("reads each shell's commands in its own dialect, and the Monitor tool's in Bash's", () => {
    expect(agentAction("Bash", { command: "npm test" })).toEqual({
      kind: "command",
      dialect: "bash",
      commandLine: "npm test",
    });
    expect(agentAction("PowerShell", { command: "npm test" })).toEqual({
      kind: "command",
      dialect: "powershell",
      commandLine: "npm test",
    });
    expect(
      agentAction("Monitor", { description: "", timeout_ms: 1, command: "tail -f log" }),
    ).toEqual({
      kind: "command",
      dialect: "bash",
      commandLine: "tail -f log",
    });
    expect(
      agentAction("Monitor", { description: "", timeout_ms: 1, ws: { url: "ws://x" } }),
    ).toEqual({
      kind: "web",
    });
  });

  it("knows the web, the Office tools and the engine's own workings", () => {
    expect(agentAction("WebSearch", { query: "x" })).toEqual({ kind: "web" });
    expect(agentAction("WebFetch", { url: "https://x" })).toEqual({ kind: "web" });
    expect(agentAction("mcp__office__handover_note", {})).toEqual({ kind: "office-tool" });
    for (const tool of ["Skill", "ToolSearch", "Task", "Agent", "StructuredOutput", "TaskStop"]) {
      expect(agentAction(tool, {})).toEqual({ kind: "engine" });
    }
  });

  it("names every other tool unavailable", () => {
    for (const tool of ["EnterWorktree", "RemoteTrigger", "CronCreate", "SendMessage"]) {
      expect(agentAction(tool, {})).toEqual({ kind: "unavailable", tool });
    }
  });

  it("names an MCP server's tool by the server and the tool, the server ending at its first __", () => {
    expect(agentAction("mcp__brave-search__web__search", {})).toEqual({
      kind: "mcp-tool",
      server: "brave-search",
      tool: "web__search",
    });
    expect(agentAction("mcp__office__read_task", {})).toEqual({ kind: "office-tool" });
  });
});
