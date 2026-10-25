import type { ShellDialect } from "./shell-commands.js";

/**
 * What a tool call does, as the Office rules judge it, whatever the engine names the tool. Paths
 * are as the call gives them: absolute, or relative to the working folder.
 */
export type AgentAction =
  | { readonly kind: "read"; readonly paths: readonly string[] }
  | { readonly kind: "edit"; readonly paths: readonly string[] }
  | { readonly kind: "command"; readonly dialect: ShellDialect; readonly commandLine: string }
  | { readonly kind: "web" }
  | { readonly kind: "office-tool" }
  /** The engine's own workings: loading a skill or a tool, a subagent, a turn's structured output. */
  | { readonly kind: "engine" }
  /** A tool The Office doesn't give Agents, by the engine's name for it. */
  | { readonly kind: "unavailable"; readonly tool: string };
