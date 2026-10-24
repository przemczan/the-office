import type { SDKSystemMessage } from "@anthropic-ai/claude-agent-sdk";
import { relative } from "node:path";
import type { ProbeSession } from "../../probe-session.ts";

export function sortedNames(names: Iterable<string>): string[] {
  return [...new Set(names)].sort();
}

/**
 * Skill names in the model's listing, after the allowlist and the overrides. The `summary` detail
 * skips the token-count calls, which names do not need.
 */
export async function listedSkillNames(session: ProbeSession): Promise<string[]> {
  const usage = await session.control.getContextUsage({ detail: "summary" });
  return sortedNames(usage.skills?.skillFrontmatter.map((skill) => skill.name) ?? []);
}

/** Names a `/name` prompt runs that are not Claude Code's own: skills, commands and plugin skills. */
export async function userInvocableNames(session: ProbeSession): Promise<string[]> {
  const commands = await session.control.supportedCommands();
  return sortedNames(commands.filter((command) => command.builtin !== true).map((command) => command.name));
}

export function pluginErrors(init: SDKSystemMessage): string[] {
  return sortedNames((init.plugin_errors ?? []).map((error) => `${error.plugin}: ${error.type}`));
}

/** Whether `name` is the skill itself or any plugin's or nested folder's skill of that name. */
export function namesSkill(name: string, skill: string): boolean {
  return name === skill || name.endsWith(`:${skill}`);
}

/** Path equality as the platform compares paths, case-insensitive on Windows. */
export function samePath(a: string, b: string): boolean {
  return relative(a, b) === "";
}
