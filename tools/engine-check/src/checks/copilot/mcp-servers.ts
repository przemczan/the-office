import { defineTool, type SessionEvent } from "@microsoft/copilot-sdk";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { Check } from "../../check.ts";
import { eventsOfType, lastAnswer } from "../../copilot-cli/events.ts";
import {
  PROJECT_SERVER,
  PROJECT_SERVER_TOOL,
  PROJECT_SERVER_TOOL_NAME,
  projectMcpServer,
} from "../../copilot-cli/project-mcp-server.ts";
import { answerHolds, preToolUseCalls } from "./helpers.ts";

const CODE_WORD = "QUARTZ";
const STATUS_WORD = "COBALT";
const REVIEW_WORD = "GRANITE";
const BARGE_IN_WORD = "STEERED";
const SLOW_TOOL = "office_review_result";
/** How long the slow Office tool answers after the barge-in was sent. */
const ANSWER_AFTER_MS = 2000;

/** A promise the check opens by hand: the slow tool's handler and the check wait on each other. */
class Gate {
  readonly opened: Promise<void>;
  private resolve!: () => void;

  constructor() {
    this.opened = new Promise((resolve) => {
      this.resolve = resolve;
    });
  }

  open(): void {
    this.resolve();
  }
}

/** Where the user message holding `text` is among `events`, -1 when there is none. */
function userMessageIndex(events: readonly SessionEvent[], text: string): number {
  return events.findIndex(
    (event) => event.type === "user.message" && event.data.content.includes(text),
  );
}

/** Where the completion of the first call of `toolName` is among `events`, -1 when there is none. */
function completionIndex(events: readonly SessionEvent[], toolName: string): number {
  const callId = eventsOfType(events, "tool.execution_start").find(
    (event) => event.data.toolName === toolName,
  )?.data.toolCallId;
  return events.findIndex(
    (event) => event.type === "tool.execution_complete" && event.data.toolCallId === callId,
  );
}

/**
 * The Project's MCP servers and the Office's tools: a stdio MCP server given per session runs its
 * tool in its own process, seen by the hook under its runtime name; a tool the check's own process
 * answers (`defineTool`) is answered; and a message sent with `mode: "immediate"` while such a tool
 * is still answering lands before or after the tool's result, and whether the answer reads both.
 */
export const copilotMcpServersCheck: Check = {
  id: "copilot.mcp-servers",
  title:
    "a per-session stdio MCP server and an Office tool are used; a barge-in during a slow Office tool is read",
  timeoutMs: 8 * 60 * 1000,
  async run({ sandbox, startCopilotSession }) {
    const repository = await sandbox.createRepository();
    const callLog = join(sandbox.root, "mcp-calls.log");
    const handlerRunning = new Gate();
    const bargedIn = new Gate();
    const session = await startCopilotSession({
      repository,
      mcpServers: { [PROJECT_SERVER]: projectMcpServer(CODE_WORD, callLog) },
      officeTools: [
        defineTool("office_status", {
          description: "Answers the Task's status in The Office.",
          parameters: { type: "object", properties: {} },
          handler: () => `Status: ${STATUS_WORD}`,
        }),
        defineTool(SLOW_TOOL, {
          description: "Answers the review's result from The Office; takes a few seconds.",
          parameters: { type: "object", properties: {} },
          handler: async () => {
            handlerRunning.open();
            await bargedIn.opened;
            await delay(ANSWER_AFTER_MS);
            return `The review result is ${REVIEW_WORD}.`;
          },
        }),
      ],
    });
    const mcpTurn = await session.turn(
      `Call the ${PROJECT_SERVER_TOOL} tool of the ${PROJECT_SERVER} server and reply with the code word it gives.`,
    );
    const servers = await session.sdk.rpc.mcp.list();
    const officeTurn = await session.turn(
      "Call the office_status tool and reply with the status it gives.",
    );

    const from = session.events.length;
    await session.send(`Call the ${SLOW_TOOL} tool once and reply with the result it gives.`);
    await handlerRunning.opened;
    const bargeIn = `When you reply, also include the word ${BARGE_IN_WORD}.`;
    await session.send(bargeIn, { mode: "immediate" });
    bargedIn.open();
    const bargeInAt = await session.waitFor(
      (event) => event.type === "user.message" && event.data.content.includes(bargeIn),
      from,
    );
    await session.untilIdle(bargeInAt);
    const raceEvents = session.events.slice(from);
    const bargeInIndex = userMessageIndex(raceEvents, bargeIn);
    const toolResultIndex = completionIndex(raceEvents, SLOW_TOOL);
    return {
      mcpServerRan: (await readFile(callLog, "utf8").catch(() => "")).includes(PROJECT_SERVER_TOOL),
      hookSawMcpTool: preToolUseCalls(session.hookCalls).some(
        (call) => call.toolName === PROJECT_SERVER_TOOL_NAME,
      ),
      mcpServerStatus:
        servers.servers.find((server) => server.name === PROJECT_SERVER)?.status ?? "not listed",
      mcpAnswerRead: answerHolds(mcpTurn, CODE_WORD),
      officeToolAnswerRead: answerHolds(officeTurn, STATUS_WORD),
      bargeIn: {
        toolCompleted: toolResultIndex !== -1,
        landedBeforeToolResult: bargeInIndex !== -1 && bargeInIndex < toolResultIndex,
        answerReadBoth:
          lastAnswer(raceEvents).includes(REVIEW_WORD) && answerHolds(raceEvents, BARGE_IN_WORD),
        idles: eventsOfType(raceEvents, "session.idle").length,
      },
    };
  },
};
