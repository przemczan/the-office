import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { Check } from "../../check.ts";
import type { ProbeSession } from "../../probe-session.ts";
import { observeCall, type CallObservation } from "../permissions/call-observations.ts";
import { toolCalls } from "../tool-calls.ts";
import { OFFICE_TOOL_SERVER, officeToolName, textResult, withOfficeTools } from "./office-tools.ts";

const TOOL = "handover_note";
const NOTE = "check";

type ToolTrial = {
  call: CallObservation;
  handlerReceived: string[];
};

/**
 * An Office tool from `createSdkMcpServer()` runs in the host process (spec §5.4). It is tried with
 * the allow rule a Role's profile would hold and without one, since `permissionPrompts: 'none'`
 * refuses whatever would prompt.
 */
export const officeToolCheck: Check = {
  id: "engine.office-tool",
  title: "an in-process Office tool from createSdkMcpServer() is callable",
  async run({ sandbox, startSession }) {
    const repository = await sandbox.createRepository();
    const allowed = await tryOfficeTool((notes) => startSession({ repository, ...withOfficeTools([handoverNoteTool(notes)]) }));
    const unallowed = await tryOfficeTool((notes) => startSession({ repository, ...withOfficeTools([handoverNoteTool(notes)], false) }));
    return {
      listedInInitTools: allowed.listed,
      serverStatus: allowed.serverStatus,
      withAllowRule: allowed.trial,
      withoutAllowRule: unallowed.trial,
    };
  },
};

function handoverNoteTool(notes: string[]) {
  return tool(TOOL, "Saves the Agent's handover note on the Task.", { note: z.string() }, async ({ note }) => {
    notes.push(note);
    return textResult("Handover note saved.");
  });
}

async function tryOfficeTool(start: (notes: string[]) => Promise<ProbeSession>): Promise<{ listed: boolean; serverStatus: string | null; trial: ToolTrial }> {
  const notes: string[] = [];
  const session = await start(notes);
  session.send(`Call the ${TOOL} tool once with the note "${NOTE}". Do not retry a refused call. Then reply with just OK.`);
  const init = await session.init();
  await session.nextResult();
  const name = officeToolName(TOOL);
  return {
    listed: init.tools.includes(name),
    serverStatus: init.mcp_servers.find((server) => server.name === OFFICE_TOOL_SERVER)?.status ?? null,
    trial: { call: observeCall(session, toolCalls(session.messages).filter((call) => call.name === name)), handlerReceived: notes },
  };
}
