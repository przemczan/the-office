import type { Check, Observation } from "../../check.ts";
import type { ApprovalCall, CodexSession } from "../../codex/codex-session.ts";
import type { ThreadItem } from "../../codex/protocol.ts";
import { OFFICE_TOOL_SERVER } from "../../office-options.ts";
import { HANDOVER_NOTE, handoverNoteTool } from "../fallback/office-tools.ts";
import { sortedNames } from "../observations.ts";
import { turnEnding } from "./observations.ts";

const NOTE = "Checked.";
const DECLINED_NOTE = "Declined.";

type McpToolCallItem = Extract<ThreadItem, { type: "mcpToolCall" }>;

/**
 * Office tools on the Codex engine (spec §5.4 Defaults, the Codex engine): the session's MCP server
 * over Streamable HTTP on `127.0.0.1` behind a per-session bearer token, connected, called with the
 * expected arguments; the approval request the app-server sends before the call, and a declined one.
 */
export const codexOfficeToolCheck: Check = {
  id: "codex.office-tool",
  title:
    "the Office tool server over MCP is connected and its tool runs with the expected arguments",
  async run({ sandbox, startCodexSession }) {
    const notes: string[] = [];
    const approvalsWhenHandlerRan: number[] = [];
    const handoverNote = handoverNoteTool(notes);
    let session: CodexSession | undefined;
    session = await startCodexSession({
      repository: await sandbox.createRepository(),
      officeTools: [
        {
          ...handoverNote,
          run: (input) => {
            approvalsWhenHandlerRan.push(session?.approvalCalls.length ?? 0);
            return handoverNote.run(input);
          },
        },
      ],
      decide: (call) => (toolArguments(call)?.["note"] === DECLINED_NOTE ? "decline" : "accept"),
    });
    await session.startThread();
    const accepted = await callTool(session, NOTE);
    const declined = await callTool(session, DECLINED_NOTE);
    const requests = session.officeToolRequests ?? { withToken: 0, refused: 0 };
    const approvals = session.approvalCalls;
    return {
      accepted,
      declined,
      requestsCarriedToken: requests.withToken > 0,
      requestsRefused: requests.refused,
      mcpMethods: sortedNames(new Set(session.officeToolMethods)),
      handlerRanWith: notes,
      approvalMethods: sortedNames(new Set(approvals.map((call) => call.method))),
      approvalBeforeHandler: approvalsWhenHandlerRan.every((count, index) => count > index),
      approvalKinds: sortedNames(
        new Set(approvals.map((call) => String(approvalMeta(call)?.["codex_approval_kind"]))),
      ),
      approvalNamesToolAndArguments: approvals.every(
        (call) =>
          approvalMeta(call)?.["tool_name"] === HANDOVER_NOTE && toolArguments(call) !== undefined,
      ),
    };
  },
};

async function callTool(session: CodexSession, note: string): Promise<Observation> {
  const started = await session.startTurn(
    `Call the ${HANDOVER_NOTE} tool of the ${OFFICE_TOOL_SERVER} MCP server once, with the note "${note}". ` +
      `Do not retry it if it is declined. Then reply with just OK.`,
  );
  const turn = await session.nextTurnEnd();
  const calls = session
    .completedItems(started.id)
    .filter((item): item is McpToolCallItem => item.type === "mcpToolCall");
  return {
    turnEnded: turnEnding(turn),
    toolCalls: calls.map((call) => `${call.server}/${call.tool}: ${call.status}`),
  };
}

/** What an MCP tool call's approval (`mcpServer/elicitation/request`) says in its `_meta`. */
function approvalMeta(call: ApprovalCall): Record<string, unknown> | undefined {
  const meta = (call.params as unknown as Record<string, unknown>)["_meta"];
  return typeof meta === "object" && meta !== null ? (meta as Record<string, unknown>) : undefined;
}

function toolArguments(call: ApprovalCall): Record<string, unknown> | undefined {
  return approvalMeta(call)?.["tool_params"] as Record<string, unknown> | undefined;
}
