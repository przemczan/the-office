import { FIRST_CLAUDE_CODE_ENGINE } from "../../domain/engines.js";
import type { SessionOptions } from "../../ports/session-options.js";
import { claudeCodePArguments, type ClaudeCodePSession } from "./claude-code-p-arguments.js";

// What claude-code-p-arguments.test.ts and claude-code-p-arguments.full.test.ts share.

export const OPTIONS: SessionOptions = {
  folder: "/office/worktrees/task-1",
  environment: { PATH: "/usr/bin" },
  engine: FIRST_CLAUDE_CODE_ENGINE,
  model: "claude-haiku-5-5",
  effort: "medium",
  skills: undefined,
  profile: { edit: true, run: { kind: "anything" }, web: true, mcpTools: {} },
  officeTools: [],
  mcpServers: [],
  languageServers: [],
  instructions: "",
  outputSchema: undefined,
};

export const SKILLS = {
  folder: "/office/sessions/session-1/skills",
  names: ["office:tdd", "deploy"],
  expected: ["deploy", "office:tdd"],
  overrides: { lint: "off" },
} as const;

export const HOOK_URL = "http://127.0.0.1:4310/api/engine/claude-code-p/hook";

export function argumentsFor(session: Partial<ClaudeCodePSession> = {}): string[] {
  return claudeCodePArguments({
    id: "session-1",
    resumes: false,
    options: OPTIONS,
    agentShells: ["bash"],
    hookUrl: HOOK_URL,
    instructionsFile: undefined,
    mcpConfigFile: undefined,
    languageServerPlugin: undefined,
    ...session,
  });
}

/** The value of a `--name=value` flag, or undefined when the flag isn't there. */
export function flag(args: readonly string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

export function settingsOf(args: readonly string[]): Record<string, unknown> {
  return JSON.parse(flag(args, "settings") ?? "{}") as Record<string, unknown>;
}
