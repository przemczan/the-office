import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { OfficeTool } from "../../ports/office-tool.js";
import type { SessionOptions } from "../../ports/session-options.js";
import { sessionSettings } from "../claude-code/session-settings.js";
import {
  claudeCodePArguments,
  TOKEN_VARIABLE,
  type ClaudeCodePSession,
} from "./claude-code-p-arguments.js";

const OPTIONS: SessionOptions = {
  folder: "/office/worktrees/task-1",
  environment: { PATH: "/usr/bin" },
  model: "claude-haiku-5-5",
  effort: "medium",
  skills: undefined,
  profile: { edit: true, run: { kind: "anything" }, web: true },
  officeTools: [],
  instructions: "",
  outputSchema: undefined,
};

const SKILLS = {
  folder: "/office/sessions/session-1/skills",
  names: ["office:tdd", "deploy"],
  expected: ["deploy", "office:tdd"],
  overrides: { lint: "off" },
} as const;

const NOTE_TOOL: OfficeTool = {
  name: "note",
  description: "Notes a word.",
  input: z.object({ word: z.string() }),
  run: () => Promise.resolve({ text: "Noted.", isError: false }),
};

const HOOK_URL = "http://127.0.0.1:4310/api/engine/claude-code-p/hook";
const MCP_URL = "http://127.0.0.1:4310/api/engine/claude-code-p/mcp";
const AUTHORIZATION = { Authorization: `Bearer \${${TOKEN_VARIABLE}}` };

function argumentsFor(session: Partial<ClaudeCodePSession> = {}): string[] {
  return claudeCodePArguments({
    id: "session-1",
    resumes: false,
    options: OPTIONS,
    agentShells: ["bash"],
    hookUrl: HOOK_URL,
    mcpUrl: MCP_URL,
    instructionsFile: undefined,
    ...session,
  });
}

/** The value of a `--name=value` flag, or undefined when the flag isn't there. */
function flag(args: readonly string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function settingsOf(args: readonly string[]): Record<string, unknown> {
  return JSON.parse(flag(args, "settings") ?? "{}") as Record<string, unknown>;
}

describe("claudeCodePArguments", () => {
  it("starts a new session by its id in -p, stream-json in and out, on the lean options", () => {
    const args = argumentsFor();

    expect(args.slice(0, 4)).toEqual([
      "--print",
      "--input-format=stream-json",
      "--output-format=stream-json",
      "--verbose",
    ]);
    expect(flag(args, "model")).toBe("claude-haiku-5-5");
    expect(flag(args, "effort")).toBe("medium");
    expect(flag(args, "setting-sources")).toBe("project");
    expect(flag(args, "permission-prompts")).toBe("none");
    expect(args).toContain("--exclude-dynamic-system-prompt-sections");
    expect(flag(args, "session-id")).toBe("session-1");
    expect(flag(args, "resume")).toBeUndefined();
  });

  it("resumes an ended session by its id", () => {
    const args = argumentsFor({ resumes: true });

    expect(flag(args, "resume")).toBe("session-1");
    expect(flag(args, "session-id")).toBeUndefined();
  });

  it("names the same tools as the SDK adapter, PowerShell beside Bash where Agents have it", () => {
    const tools = flag(argumentsFor({ agentShells: ["bash", "powershell"] }), "tools")?.split(",");

    expect(tools).toContain("Bash");
    expect(tools).toContain("PowerShell");
    expect(tools).toContain("Grep");
    expect(tools).toEqual(tools?.toSorted());
  });

  it("loads the session's skills folder and allows each of its skills by rule", () => {
    const args = argumentsFor({ options: { ...OPTIONS, skills: SKILLS } });

    expect(flag(args, "plugin-dir")).toBe(SKILLS.folder);
    expect(flag(args, "allowedTools")).toBe("Skill(office:tdd),Skill(deploy)");
  });

  it("loads no plugin and allows no skill for a session without skills", () => {
    const args = argumentsFor();

    expect(flag(args, "plugin-dir")).toBeUndefined();
    expect(flag(args, "allowedTools")).toBeUndefined();
  });

  it("gives the SDK adapter's settings, with a hook that asks the service and blocks when it can't", () => {
    const options = { ...OPTIONS, skills: SKILLS };
    const settings = settingsOf(argumentsFor({ options }));

    expect(settings).toEqual({
      ...sessionSettings(options),
      hooks: {
        PreToolUse: [
          {
            hooks: [
              {
                type: "http",
                url: HOOK_URL,
                headers: AUTHORIZATION,
                allowedEnvVars: [TOKEN_VARIABLE],
                timeout: 600,
                onFailure: "block",
              },
            ],
          },
        ],
      },
    });
  });

  it("serves the Office tools from the service's MCP endpoint, the token from the environment", () => {
    const options = { ...OPTIONS, officeTools: [NOTE_TOOL] };
    const args = argumentsFor({ options });

    expect(JSON.parse(flag(args, "mcp-config") ?? "{}")).toEqual({
      mcpServers: {
        office: { type: "http", url: MCP_URL, headers: AUTHORIZATION, alwaysLoad: true },
      },
    });
    expect(settingsOf(args)).toMatchObject({ permissions: { allow: ["mcp__office"] } });
    expect(args.join(" ")).not.toMatch(/Bearer [^$]/);
  });

  it("names no MCP server for a session without Office tools", () => {
    expect(flag(argumentsFor(), "mcp-config")).toBeUndefined();
  });

  it("appends the instructions from their file, and holds each turn to the output schema", () => {
    const schema = { type: "object", properties: { answer: { type: "string" } } };
    const args = argumentsFor({
      options: { ...OPTIONS, instructions: "Be brief.", outputSchema: schema },
      instructionsFile: "/tmp/office-claude-code-p-1/instructions.md",
    });

    expect(flag(args, "append-system-prompt-file")).toBe(
      "/tmp/office-claude-code-p-1/instructions.md",
    );
    expect(JSON.parse(flag(args, "json-schema") ?? "null")).toEqual(schema);
  });

  it("appends nothing without instructions, and asks no output schema without one", () => {
    const args = argumentsFor();

    expect(flag(args, "append-system-prompt-file")).toBeUndefined();
    expect(flag(args, "json-schema")).toBeUndefined();
  });
});
