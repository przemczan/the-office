import { describe, expect, it } from "vitest";
import type { ToolDecision } from "../../domain/office-rules.js";
import { agentAction } from "../office-rules/tool-actions.js";
import {
  copilotDecision,
  copilotToolCall,
  type CopilotToolJudgement,
  type CopilotToolSession,
} from "./copilot-tool-actions.js";

const SESSION: CopilotToolSession = {
  officeToolNames: new Set(["office_status"]),
  mcpServerNames: ["project-tools", "project", "docs"],
};

function judged(name: string, args: unknown): Extract<CopilotToolJudgement, { kind: "judged" }> {
  const result = copilotToolCall(name, args, SESSION);
  if (result.kind !== "judged") throw new Error(`refused: ${result.reason}`);
  return result;
}

function refused(name: string, args: unknown): string {
  const result = copilotToolCall(name, args, SESSION);
  if (result.kind !== "refused") throw new Error("judged");
  return result.reason;
}

describe("the shell", () => {
  it("is Bash with the command, and bash as the dialect the rules read", () => {
    const { calls, display } = judged("bash", { command: "ls -la", description: "list" });
    expect(calls).toEqual([
      { tool: "Bash", input: { command: "ls -la", description: "list", run_in_background: false } },
    ]);
    expect(display).toMatchObject({ tool: "Bash", officeTool: false });
    expect(agentAction(calls[0]!.tool, calls[0]!.input)).toEqual({
      kind: "command",
      dialect: "bash",
      commandLine: "ls -la",
    });
  });

  it("is PowerShell for powershell", () => {
    const { calls } = judged("powershell", { command: "Get-ChildItem" });
    expect(agentAction(calls[0]!.tool, calls[0]!.input)).toMatchObject({
      kind: "command",
      dialect: "powershell",
    });
  });

  it.each([
    [{ detach: true }, true],
    [{ mode: "async" }, true],
    [{ mode: "sync" }, false],
    [{}, false],
  ])("runs in the background as %j: %s", (extra, background) => {
    const { calls } = judged("bash", { command: "sleep 9", ...extra });
    expect(calls[0]?.input).toMatchObject({ run_in_background: background });
  });

  it.each(["read_bash", "list_bash", "stop_bash"])("manages a command with %s", (name) => {
    const { calls, display } = judged(name, { shellId: "1" });
    expect(agentAction(calls[0]!.tool, calls[0]!.input)).toEqual({ kind: "engine" });
    expect(display.tool).toBe("TaskStop");
  });
});

describe("files and search", () => {
  it("reads with view", () => {
    const { calls } = judged("view", { path: "/work/a.ts", view_range: [1, 5] });
    expect(calls).toEqual([{ tool: "Read", input: { file_path: "/work/a.ts" } }]);
    expect(agentAction("Read", calls[0]!.input)).toEqual({ kind: "read", paths: ["/work/a.ts"] });
  });

  it("globs with the pattern and the folder", () => {
    const { calls } = judged("glob", { pattern: "**/*.ts", path: "/work/src" });
    expect(calls).toEqual([{ tool: "Glob", input: { pattern: "**/*.ts", path: "/work/src" } }]);
  });

  it("leaves the folder of a glob out when none is named", () => {
    expect(judged("glob", { pattern: "*.md" }).calls[0]?.input).toEqual({ pattern: "*.md" });
  });

  it("greps a path", () => {
    const { calls } = judged("grep", { pattern: "todo", path: "/work/src" });
    expect(calls).toEqual([{ tool: "Grep", input: { pattern: "todo", path: "/work/src" } }]);
  });

  it("searches with rg once for each path it names, so each is judged", () => {
    const { calls } = judged("rg", {
      pattern: "x",
      paths: ["/work/a", "/etc"],
      output_mode: "content",
    });
    expect(calls.map((call) => agentAction(call.tool, call.input))).toEqual([
      { kind: "read", paths: ["/work/a"] },
      { kind: "read", paths: ["/etc"] },
    ]);
  });

  it("searches the working folder when rg names no path", () => {
    const { calls } = judged("rg", { pattern: "x" });
    expect(calls).toEqual([{ tool: "Grep", input: { pattern: "x" } }]);
    expect(agentAction("Grep", calls[0]!.input)).toEqual({ kind: "read", paths: ["."] });
  });

  it("writes with create", () => {
    const { calls } = judged("create", { path: "/work/new.txt", file_text: "hi" });
    expect(calls).toEqual([
      { tool: "Write", input: { file_path: "/work/new.txt", content: "hi" } },
    ]);
    expect(agentAction("Write", calls[0]!.input)).toEqual({
      kind: "edit",
      paths: ["/work/new.txt"],
    });
  });

  it("edits with edit", () => {
    const { calls } = judged("edit", { path: "/work/a.ts", old_str: "a", new_str: "b" });
    expect(calls).toEqual([
      { tool: "Edit", input: { file_path: "/work/a.ts", old_string: "a", new_string: "b" } },
    ]);
  });
});

describe("apply_patch", () => {
  const added = "*** Begin Patch\n*** Add File: /work/new.txt\n+hello\n*** End Patch";

  it("writes the file it adds", () => {
    const { calls, display } = judged("apply_patch", added);
    expect(calls).toEqual([{ tool: "Write", input: { file_path: "/work/new.txt" } }]);
    expect(display).toEqual({
      tool: "Write",
      officeTool: false,
      input: { file_path: "/work/new.txt" },
    });
  });

  it("edits the file it updates, from a string field of an object", () => {
    const patch = "*** Begin Patch\n*** Update File: src/a.ts\n@@\n-a\n+b\n*** End Patch";
    for (const args of [{ input: patch }, { patch }]) {
      expect(judged("apply_patch", args).calls).toEqual([
        { tool: "Edit", input: { file_path: "src/a.ts" } },
      ]);
    }
  });

  it("edits the file it deletes", () => {
    const patch = "*** Begin Patch\n*** Delete File: src/old.ts\n*** End Patch";
    expect(judged("apply_patch", patch).calls).toEqual([
      { tool: "Edit", input: { file_path: "src/old.ts" } },
    ]);
  });

  it("edits the source and writes the target of a move", () => {
    const patch =
      "*** Begin Patch\n*** Update File: src/a.ts\n*** Move to: /outside/b.ts\n@@\n-a\n+b\n*** End Patch";
    expect(judged("apply_patch", patch).calls).toEqual([
      { tool: "Edit", input: { file_path: "src/a.ts" } },
      { tool: "Write", input: { file_path: "/outside/b.ts" } },
    ]);
  });

  it("judges every file of a patch and shows the patch with its files", () => {
    const patch = `${added}\n*** Begin Patch\n*** Update File: src/a.ts\n*** Delete File: src/b.ts`;
    const { calls, display } = judged("apply_patch", patch);
    expect(calls.map((call) => call.tool)).toEqual(["Write", "Edit", "Edit"]);
    expect(display.tool).toBe("apply_patch");
    expect(display.input).toEqual({
      files: [
        { tool: "Write", file_path: "/work/new.txt" },
        { tool: "Edit", file_path: "src/a.ts" },
        { tool: "Edit", file_path: "src/b.ts" },
      ],
    });
  });

  it.each([
    ["no file named", "*** Begin Patch\n*** End Patch"],
    ["a number", 7],
    ["an empty object", {}],
  ])("refuses a patch that is %s", (_name, args) => {
    expect(refused("apply_patch", args)).toMatch(/patch couldn't be read/);
  });
});

describe("other tools", () => {
  it("fetches with web_fetch", () => {
    const { calls } = judged("web_fetch", { url: "https://example.com" });
    expect(agentAction(calls[0]!.tool, calls[0]!.input)).toEqual({ kind: "web" });
  });

  it("loads a skill by its name", () => {
    const { calls, display } = judged("skill", { skill: "review" });
    expect(calls).toEqual([{ tool: "Skill", input: { skill: "review" } }]);
    expect(display.officeTool).toBe(false);
  });

  it.each(["task", "list_agents", "read_agent", "write_agent"])(
    "refuses %s: no Sub-agents on this engine yet",
    (name) => {
      expect(refused(name, {})).toMatch(/Sub-agents aren't available/);
    },
  );

  it("judges an MCP tool by the longest server name that fits", () => {
    const { calls, display } = judged("project-tools-read_code_word", { x: 1 });
    expect(calls).toEqual([{ tool: "mcp__project-tools__read_code_word", input: { x: 1 } }]);
    expect(agentAction(calls[0]!.tool, calls[0]!.input)).toEqual({
      kind: "mcp-tool",
      server: "project-tools",
      tool: "read_code_word",
    });
    expect(display).toEqual({
      tool: "mcp__project-tools__read_code_word",
      officeTool: false,
      input: { x: 1 },
    });
  });

  it("takes a shorter server's tool when the longer server doesn't fit", () => {
    expect(judged("project-lookup", {}).calls[0]?.tool).toBe("mcp__project__lookup");
  });

  it("judges an Office tool by its own name, shown by it", () => {
    const { calls, display } = judged("office_status", { a: 1 });
    expect(agentAction(calls[0]!.tool, calls[0]!.input)).toEqual({ kind: "office-tool" });
    expect(display).toEqual({ tool: "office_status", officeTool: true, input: { a: 1 } });
  });

  it("refuses an unknown tool, naming it", () => {
    expect(refused("teleport", {})).toBe("Not available in The Office: the teleport tool.");
    expect(refused("docs-", {})).toMatch(/docs-/);
  });
});

const allow = async (): Promise<ToolDecision> => ({ allowed: true });

describe("copilotDecision", () => {
  it("allows when every call is allowed", async () => {
    const patch = "*** Add File: a\n*** Update File: b";
    expect(await copilotDecision(copilotToolCall("apply_patch", patch, SESSION), allow)).toEqual({
      allowed: true,
    });
  });

  it("answers the first refusal and asks no more", async () => {
    const asked: string[] = [];
    const patch = "*** Add File: a\n*** Update File: b\n*** Delete File: c";
    const decision = await copilotDecision(
      copilotToolCall("apply_patch", patch, SESSION),
      async (_tool, input) => {
        const path = (input as { file_path: string }).file_path;
        asked.push(path);
        return path === "b" ? { allowed: false, reason: "no b" } : { allowed: true };
      },
    );
    expect(decision).toEqual({ allowed: false, reason: "no b" });
    expect(asked).toEqual(["a", "b"]);
  });

  it("refuses a refused translation in its words, asking nobody", async () => {
    const decision = await copilotDecision(copilotToolCall("task", {}, SESSION), async () => {
      throw new Error("asked");
    });
    expect(decision).toMatchObject({
      allowed: false,
      reason: expect.stringContaining("Sub-agents"),
    });
  });
});
