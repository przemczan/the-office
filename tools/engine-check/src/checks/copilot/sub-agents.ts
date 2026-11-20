import type { Check } from "../../check.ts";
import type { CopilotSession } from "../../copilot-cli/copilot-session.ts";
import { eventsOfType } from "../../copilot-cli/events.ts";
import { sortedNames } from "../observations.ts";
import { preToolUseCalls, refusal, writeRepositoryFile } from "./helpers.ts";

const DELEGATE_PROMPT =
  "Delegate this to a sub-agent with your task tool, and don't search yourself: have it search this " +
  "repository's files for the text `lighthouse` and report which files hold it. Then reply with its answer.";
/** The runtime's name for the tool that starts a Sub-agent when no call shows it. */
const DEFAULT_SUB_AGENT_TOOL = "task";

async function agentNames(session: CopilotSession): Promise<string[]> {
  const { agents } = await session.sdk.rpc.agent.list({ includeBuiltInAgents: true });
  return sortedNames(agents.map((agent) => agent.name));
}

/**
 * Sub-agents on the Copilot engine: which built-in agents a session has, and with
 * `builtInAgents: []`; whether a delegated search starts a Sub-agent whose own calls reach the
 * `preToolUse` hook; and whether refusing the tool that starts it keeps the Sub-agent from starting.
 */
export const copilotSubAgentsCheck: Check = {
  id: "copilot.sub-agents",
  title:
    "a delegated search starts a Sub-agent whose calls reach the hook, and refusing its tool stops it",
  timeoutMs: 8 * 60 * 1000,
  async run({ sandbox, startCopilotSession }) {
    const repository = await sandbox.createRepository();
    await writeRepositoryFile(repository, "docs/guide.md", "The lighthouse is on the hill.\n");
    const session = await startCopilotSession({ repository });
    const defaultAgents = await agentNames(session);
    const events = await session.turn(DELEGATE_PROMPT);
    const started = eventsOfType(events, "subagent.started");
    const startingCalls = new Set(started.map((event) => event.data.toolCallId));
    const startingHook = preToolUseCalls(session.hookCalls).find(
      (call) => call.toolCallId !== undefined && startingCalls.has(call.toolCallId),
    );
    const subAgentTool =
      startingHook?.toolName ??
      eventsOfType(events, "tool.execution_start").find((event) =>
        startingCalls.has(event.data.toolCallId),
      )?.data.toolName ??
      DEFAULT_SUB_AGENT_TOOL;

    const noBuiltIns = await startCopilotSession({ repository, builtInAgents: [] });
    const refused = await startCopilotSession({ repository });
    refused.decide = ({ toolName }) =>
      toolName === subAgentTool
        ? refusal("The Office runs no Sub-agents in this Stage; search yourself.")
        : undefined;
    const refusedEvents = await refused.turn(DELEGATE_PROMPT);
    return {
      builtInAgents: defaultAgents,
      agentsWithNoBuiltIns: await agentNames(noBuiltIns),
      subAgentsStarted: sortedNames(started.map((event) => event.data.agentName)),
      subAgentTool,
      hookSawStartingCall: startingHook !== undefined,
      subAgentCallsHooked: sortedNames(
        preToolUseCalls(session.hookCalls)
          .filter((call) => call.subAgent)
          .map((call) => call.toolName),
      ),
      refusal: {
        hookRefused: preToolUseCalls(refused.hookCalls).some(
          (call) => call.toolName === subAgentTool,
        ),
        subAgentStarted: eventsOfType(refusedEvents, "subagent.started").length > 0,
      },
    };
  },
};
