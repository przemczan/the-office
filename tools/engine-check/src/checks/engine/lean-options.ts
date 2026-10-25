import type { Check } from "../../check.ts";
import type { ProbeSession } from "../../probe-session.ts";
import { sortedNames } from "../observations.ts";
import { promptTokens, requestUsages, roundedTokens, type RequestUsage } from "./requests.ts";

/**
 * The reference runner's lean set beyond what the Office already passes: an explicit built-in tool
 * list and no MCP servers but the session's own.
 */
const LEAN_TOOLS = ["Bash", "Edit", "Glob", "Grep", "PowerShell", "Read", "Skill", "Write"];

/**
 * What a session costs before any work under the Office's options, and whether two Tasks' worktrees
 * of one repository share the cached prefix (`excludeDynamicSections` moves the working directory out
 * of the system prompt). The leaner variant is measured without a model call, as a proposal.
 */
export const leanOptionsCheck: Check = {
  id: "engine.lean-options",
  title:
    "the lean option set: context size of a first call, and an identical cached prefix in two worktrees of one repository",
  async run({ sandbox, startSession }) {
    const repository = await sandbox.createRepository();
    const firstWorktree = await sandbox.addWorktree(repository, "task-a");
    const secondWorktree = await sandbox.addWorktree(repository, "task-b");
    const first = await firstCall(await startSession({ repository: firstWorktree }));
    const second = await firstCall(await startSession({ repository: secondWorktree }));

    const lean = await startSession({
      repository: firstWorktree,
      options: { tools: LEAN_TOOLS, strictMcpConfig: true },
    });
    const leanInit = await lean.initWithoutTurn();
    const leanContext = await lean.control.getContextUsage();
    return {
      officeOptions: {
        firstCallContext: roundedTokens(promptTokens(first.request)),
        builtInTools: sortedNames(first.tools.filter((name) => !name.startsWith("mcp__"))),
        claudeAiConnectorsLoaded: first.mcpServers.some((name) => name.startsWith("claude.ai ")),
      },
      secondWorktreeReadsFirstWorktreesPrefix:
        second.request.cacheRead > 0 && second.request.cacheRead >= first.request.cacheRead,
      leanVariant: {
        context: roundedTokens(leanContext.totalTokens),
        tools: sortedNames(leanInit.tools),
        mcpServers: sortedNames(leanInit.mcp_servers.map((server) => server.name)),
      },
    };
  },
};

async function firstCall(
  session: ProbeSession,
): Promise<{ request: RequestUsage; tools: string[]; mcpServers: string[] }> {
  session.send("Reply with just OK.");
  const init = await session.init();
  await session.nextResult();
  const [request] = requestUsages(session.messages);
  if (request === undefined) {
    throw new Error(`Session ${session.sessionId} made no model request`);
  }
  return { request, tools: init.tools, mcpServers: init.mcp_servers.map((server) => server.name) };
}
