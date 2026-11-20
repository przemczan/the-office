import { describe, expect, it } from "vitest";
import {
  displayedCall,
  geminiDecision,
  geminiToolCall,
  type GeminiToolSession,
} from "./gemini-tool-actions.js";

const BASH: GeminiToolSession = { mcpServerNames: ["project-tools", "docs"], shell: "Bash" };
const POWERSHELL: GeminiToolSession = { ...BASH, shell: "PowerShell" };

function judged(toolName: string, input: unknown, session = BASH) {
  return geminiToolCall({ toolName, input }, session);
}

describe("geminiToolCall", () => {
  it.each([
    ["read_file", { file_path: "a.md", start_line: 2 }, "Read", { file_path: "a.md" }],
    [
      "write_file",
      { file_path: "a.md", content: "x" },
      "Write",
      { file_path: "a.md", content: "x" },
    ],
    [
      "replace",
      { file_path: "a.md", old_string: "x", new_string: "y", instruction: "fix" },
      "Edit",
      { file_path: "a.md", old_string: "x", new_string: "y" },
    ],
    ["glob", { pattern: "**/*.ts", dir_path: "src" }, "Glob", { pattern: "**/*.ts", path: "src" }],
    ["grep_search", { pattern: "TODO" }, "Grep", { pattern: "TODO" }],
    ["list_directory", { dir_path: "/etc" }, "Glob", { pattern: "*", path: "/etc" }],
  ])("judges %s as %s", (toolName, input, tool, judgedInput) => {
    expect(judged(toolName, input)).toEqual({
      kind: "judged",
      call: { tool, officeTool: false, input: judgedInput },
    });
  });

  it("judges a shell command in the session's shell, its folder as a change of folder first", () => {
    expect(judged("run_shell_command", { command: "ls", description: "Lists" })).toEqual({
      kind: "judged",
      call: { tool: "Bash", officeTool: false, input: { command: "ls", description: "Lists" } },
    });
    expect(judged("run_shell_command", { command: "ls", dir_path: "/it's" })).toMatchObject({
      call: { input: { command: `cd '/it'\\''s' && ls` } },
    });
    expect(
      judged("run_shell_command", { command: "ls", dir_path: "C:\\it's" }, POWERSHELL),
    ).toMatchObject({
      call: { tool: "PowerShell", input: { command: "Set-Location -LiteralPath 'C:\\it''s'; ls" } },
    });
  });

  it("refuses a command run in the background, as it would outlive Stop", () => {
    expect(judged("run_shell_command", { command: "npm run dev", is_background: true })).toEqual({
      kind: "refused",
      reason: expect.stringContaining("can't run in the background"),
    });
  });

  it("judges an Office tool by its Office name, and Skill and StructuredOutput as the engine's own", () => {
    expect(judged("mcp_office_note_progress", { summary: "done" })).toEqual({
      kind: "judged",
      call: { tool: "mcp__office__note_progress", officeTool: true, input: { summary: "done" } },
    });
    expect(judged("mcp_office_Skill", { skill: "office:review" })).toEqual({
      kind: "judged",
      call: { tool: "Skill", officeTool: false, input: { skill: "office:review" } },
    });
    expect(judged("mcp_office_StructuredOutput", { word: "fig" })).toMatchObject({
      call: { tool: "StructuredOutput", officeTool: false },
    });
  });

  it("judges an MCP tool of the session's servers by the hook's context or by the longest name", () => {
    expect(
      geminiToolCall(
        { toolName: "mcp_docs_search", input: { q: "x" }, mcpServer: "docs", mcpTool: "search" },
        BASH,
      ),
    ).toEqual({
      kind: "judged",
      call: { tool: "mcp__docs__search", officeTool: false, input: { q: "x" } },
    });
    expect(judged("mcp_project-tools_check_secret", {})).toMatchObject({
      call: { tool: "mcp__project-tools__check_secret" },
    });
  });

  it("refuses an unknown tool and an MCP tool of no server of the session", () => {
    for (const toolName of ["web_fetch", "google_web_search", "save_memory", "mcp_other_tool"]) {
      expect(judged(toolName, {})).toEqual({
        kind: "refused",
        reason: `Not available in The Office: the ${toolName} tool.`,
      });
    }
    expect(
      geminiToolCall(
        { toolName: "mcp_other_tool", input: {}, mcpServer: "other", mcpTool: "tool" },
        BASH,
      ),
    ).toMatchObject({ kind: "refused" });
  });
});

describe("displayedCall", () => {
  it("shows an Office tool by its own name, and an unknown tool by the CLI's", () => {
    expect(displayedCall({ toolName: "mcp_office_note", input: { word: "x" } }, BASH)).toEqual({
      tool: "note",
      officeTool: true,
      input: { word: "x" },
    });
    expect(displayedCall({ toolName: "web_fetch", input: undefined }, BASH)).toEqual({
      tool: "web_fetch",
      officeTool: false,
      input: {},
    });
  });
});

describe("geminiDecision", () => {
  it("refuses a refused translation without asking the rules", async () => {
    let asked = false;
    const decision = await geminiDecision({ kind: "refused", reason: "No." }, () => {
      asked = true;
      return Promise.resolve({ allowed: true });
    });

    expect(decision).toEqual({ allowed: false, reason: "No." });
    expect(asked).toBe(false);
  });

  it("asks the rules about the judged call", async () => {
    const decision = await geminiDecision(judged("read_file", { file_path: "a" }), (tool, input) =>
      Promise.resolve({ allowed: false, reason: `${tool} ${JSON.stringify(input)}` }),
    );

    expect(decision).toEqual({ allowed: false, reason: 'Read {"file_path":"a"}' });
  });
});
