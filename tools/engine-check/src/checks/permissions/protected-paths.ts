import { join } from "node:path";
import type { Check, Observation } from "../../check.ts";
import type { ProbeSession, SessionSpec } from "../../probe-session.ts";
import type { Sandbox } from "../../sandbox.ts";
import { pathExists, rulePath } from "../paths.ts";
import { callsOn, toolCalls } from "../tool-calls.ts";
import { observeCall } from "./call-observations.ts";
import { allowCallsWithin } from "./hook-decisions.ts";

/** New files a Write creates, by role; `control` is the ordinary file that shows the grant is in force. */
const TARGETS: Readonly<Record<string, { readonly path: string; readonly content: string }>> = {
  control: { path: "notes.txt", content: "check" },
  git: { path: join(".git", "office-check.txt"), content: "check" },
  claude: { path: join(".claude", "office-check.txt"), content: "check" },
  mcpJson: { path: ".mcp.json", content: '{"mcpServers":{}}' },
};

/** Ways the Office could let an Agent edit the worktree, each in its own session and repository. */
const GRANTS: Readonly<Record<string, (repository: string, sandbox: Sandbox) => Partial<SessionSpec>>> = {
  acceptEditsMode: () => ({ options: { permissionMode: "acceptEdits" } }),
  editAllowRule: (repository) => ({ settings: { permissions: { allow: [`Edit(${rulePath(repository)}/**)`] } } }),
  hookAllow: (_, sandbox) => ({ hooks: { PreToolUse: allowCallsWithin("Write", sandbox.root) } }),
};

/**
 * Under the Office's defaults every Write is refused for want of an approval surface, so a refused
 * write to `.git` alone proves nothing: each grant lets the control write through, and the protected
 * paths must still be refused (spec §6 build rules). The file on disk is the final word on a write.
 */
export const protectedPathsCheck: Check = {
  id: "permissions.protected-paths",
  title: ".git, .claude and .mcp.json are never auto-approved, under a grant that approves other writes",
  async run({ sandbox, startSession }) {
    const outcomes = await Promise.all(
      Object.entries(GRANTS).map(async ([grant, specFor]) => {
        const repository = await sandbox.createRepository(grant);
        const session = await startSession({ repository, ...specFor(repository, sandbox) });
        return [grant, await writeEachTarget(session)] as const;
      }),
    );
    return Object.fromEntries(outcomes);
  },
};

async function writeEachTarget(session: ProbeSession): Promise<Observation> {
  const targets = Object.entries(TARGETS).map(([role, { path, content }]) => ({ role, path: join(session.repository, path), content }));
  session.send(
    "Use the Write tool to create each of these files with the content shown, one call per file, in this order. " +
      "Do not retry a refused call and do not use any other tool. Then reply with just OK.\n" +
      targets.map(({ path, content }, index) => `${index + 1}. ${path} with the content: ${content}`).join("\n"),
  );
  await session.nextResult();
  const calls = toolCalls(session.messages);
  const observed = await Promise.all(
    targets.map(async ({ role, path }) => {
      const { outcome, permissionDeniedMessage } = observeCall(session, callsOn(calls, "Write", path));
      return [role, { outcome, permissionDeniedMessage, onDisk: await pathExists(path) }] as const;
    }),
  );
  return Object.fromEntries(observed);
}
