import { join } from "node:path";
import type { Check } from "../../check.ts";
import type { CopilotSession } from "../../copilot-cli/copilot-session.ts";
import { toolStarts } from "../../copilot-cli/events.ts";
import { COPILOT_CHECK_MODEL } from "../../copilot-cli/options.ts";
import { projectMcpServer } from "../../copilot-cli/project-mcp-server.ts";
import { sortedNames } from "../observations.ts";
import {
  answerHolds,
  fileExists,
  isShellTool,
  offeredTools,
  preToolUseCalls,
  writeRepositoryFile,
} from "./helpers.ts";

const AGENTS_MD_WORD = "MAPLE";
const COPILOT_INSTRUCTIONS_WORD = "HARBOR";
const RESTRICTED_FILE = "restricted.txt";

function agentFile(name: string): string {
  return `---\nname: ${name}\ndescription: Reviews a change for the engine check.\n---\n\nReview the change you are given.\n`;
}

/** A server entry the runtime could start, so a listed server is one it read, not one it failed. */
function serverEntry(sandboxRoot: string, name: string): unknown {
  return projectMcpServer(name, join(sandboxRoot, `${name}.log`));
}

/**
 * Configuration the runtime could find on its own: the repository's instructions, agent and MCP
 * files, and an MCP config and agent in the runtime's config folder.
 */
async function writeDiscoverableConfiguration(
  repository: string,
  copilotHome: string,
  sandboxRoot: string,
): Promise<void> {
  await writeRepositoryFile(repository, "AGENTS.md", `The code word is ${AGENTS_MD_WORD}.\n`);
  await writeRepositoryFile(
    repository,
    ".github/copilot-instructions.md",
    `The code word is ${COPILOT_INSTRUCTIONS_WORD}.\n`,
  );
  await writeRepositoryFile(repository, ".github/agents/reviewer.agent.md", agentFile("reviewer"));
  await writeRepositoryFile(
    repository,
    ".github/mcp.json",
    JSON.stringify({ mcpServers: { "github-folder": serverEntry(sandboxRoot, "github-folder") } }),
  );
  await writeRepositoryFile(
    repository,
    ".vscode/mcp.json",
    JSON.stringify({ servers: { "vscode-folder": serverEntry(sandboxRoot, "vscode-folder") } }),
  );
  await writeRepositoryFile(
    copilotHome,
    "mcp-config.json",
    JSON.stringify({ mcpServers: { "home-config": serverEntry(sandboxRoot, "home-config") } }),
  );
  await writeRepositoryFile(
    copilotHome,
    "agents/home-reviewer.agent.md",
    agentFile("home-reviewer"),
  );
}

/** What a session loaded of the discoverable configuration, by the runtime's lists and one turn. */
async function loadedConfiguration(
  session: CopilotSession,
): Promise<Record<string, string[] | boolean>> {
  const agents = await session.sdk.rpc.agent.list();
  const mcpServers = await session.sdk.rpc.mcp.list();
  const skills = await session.sdk.rpc.skills.list();
  const events = await session.turn(
    "What code word or words do your instructions give you? Answer with just the word or words, or NONE if they give none. Use no tools.",
  );
  return {
    customAgents: sortedNames(agents.agents.map((agent) => agent.name)),
    mcpServers: sortedNames(mcpServers.servers.map((server) => server.name)),
    skills: sortedNames(skills.skills.map((skill) => skill.name)),
    agentsMdLoaded: answerHolds(events, AGENTS_MD_WORD),
    copilotInstructionsLoaded: answerHolds(events, COPILOT_INSTRUCTIONS_WORD),
  };
}

/** The read tool the runtime lists: `view` by the 1.0 runtime's name, else the first that reads. */
function readTool(builtIn: readonly string[]): string | undefined {
  return builtIn.find((name) => name === "view") ?? builtIn.find((name) => /view|read/u.test(name));
}

/**
 * The tool set: which built-in tools the runtime lists for the check model; whether the lean
 * options keep the repository's and the config folder's instructions, agents, MCP servers and skills
 * out, against discovery turned on; and whether `availableTools` limits a session to the tools it
 * names, so a session given a read tool and the shell can't write with a file tool.
 */
export const copilotToolsCheck: Check = {
  id: "copilot.tools",
  title:
    "the built-in tools; lean options load no discovered configuration; availableTools limits the tools",
  timeoutMs: 8 * 60 * 1000,
  async run({ sandbox, copilotHome, startCopilotSession }) {
    const repository = await sandbox.createRepository();
    await writeDiscoverableConfiguration(repository, copilotHome, sandbox.root);
    const lean = await startCopilotSession({ repository });
    const builtIn = (await lean.client.rpc.tools.list({ model: COPILOT_CHECK_MODEL })).tools.map(
      (tool) => tool.name,
    );
    const leanLoaded = await loadedConfiguration(lean);
    const discovering = await startCopilotSession({
      repository,
      configDiscovery: true,
      customInstructions: true,
    });
    const discoveredLoaded = await loadedConfiguration(discovering);

    const available = sortedNames(
      [readTool(builtIn), builtIn.find(isShellTool)].filter((name) => name !== undefined),
    );
    const restricted = await startCopilotSession({ repository, availableTools: available });
    const events = await restricted.turn(
      `Create a file named ${RESTRICTED_FILE} in the current folder containing the word hello, with whatever tool you have, then reply DONE.`,
    );
    return {
      builtInTools: sortedNames(builtIn),
      lean: leanLoaded,
      discovery: discoveredLoaded,
      restricted: {
        availableTools: available,
        offeredTools: await offeredTools(restricted),
        ranTools: sortedNames(toolStarts(events).map((start) => start.toolName)),
        hookedTools: sortedNames(
          preToolUseCalls(restricted.hookCalls).map((call) => call.toolName),
        ),
        fileWritten: fileExists(repository, RESTRICTED_FILE),
      },
    };
  },
};
