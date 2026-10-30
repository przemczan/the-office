import { z } from "zod";
import type { Check } from "../../check.ts";
import type { ClaudeCodePSession } from "../../claude-code-p/claude-code-p-session.ts";
import type { OfficeTool } from "../../claude-code-p/office-tool-server.ts";
import { officeToolName } from "../../office-options.ts";
import { toolCalls } from "../tool-calls.ts";
import { followBargeIn } from "../engine/message-priority.ts";

const REVIEW = "ask_for_review";
const BARGE_IN = "A note from the user: nothing changes, finish as planned.";
const PROMPT = `Call the ${REVIEW} tool once, then reply with just OK.`;

/**
 * Barge-in while an Office tool answers (spec §2.4, §5.4 Defaults): the message is sent from the
 * tool's handler, before its answer, as the contract's barge-in sends it while a held Office tool
 * waits. Over a `localhost` MCP endpoint on Windows the answer overtook the message; through the
 * binary's stream both go down its input in the order they were sent.
 */
export const fallbackOfficeToolBargeInCheck: Check = {
  id: "fallback.priority-next-office-tool",
  title:
    "a message with priority 'next' sent while an Office tool answers lands in the running turn",
  async run({ sandbox, startClaudeCodePSession }) {
    const repository = await sandbox.createRepository();
    let session: ClaudeCodePSession | undefined;
    let bargeIn: string | undefined;
    const review: OfficeTool = {
      name: REVIEW,
      description: "Asks the user to review the work so far.",
      input: { summary: z.string().optional() },
      run: async () => {
        bargeIn = session?.send(BARGE_IN, { priority: "next" });
        return "Reviewed.";
      },
    };
    session = await startClaudeCodePSession({ repository, officeTools: [review] });
    session.send(PROMPT);
    const firstTurn = await session.nextResult();
    return {
      officeToolCalls: toolCalls(session.messages).filter(
        (call) => call.name === officeToolName(REVIEW),
      ).length,
      sentWhileToolAnswered: bargeIn !== undefined,
      landedIn:
        bargeIn === undefined ? "nowhere" : await followBargeIn(session, firstTurn, bargeIn),
    };
  },
};
