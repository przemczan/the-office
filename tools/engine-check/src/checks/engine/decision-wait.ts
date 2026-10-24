import { tool } from "@anthropic-ai/claude-agent-sdk";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import type { Check } from "../../check.ts";
import { sortedNames } from "../observations.ts";
import { callsOn, lastOutcome, toolCalls } from "../tool-calls.ts";
import { officeToolName, textResult, withOfficeTools } from "./office-tools.ts";
import { readsEarlierPromptFromCache, requestUsages, turns } from "./requests.ts";

export const DECISION_WAIT_VARIABLE = "ENGINE_CHECK_DECISION_WAIT_MINUTES";
/** Just past the main conversation's 1-hour cache lifetime. */
export const DEFAULT_DECISION_WAIT_MINUTES = 62;
const ONE_HOUR_MS = 60 * 60 * 1000;
const TOOL = "open_decision";
const OPTIONS = ["option-a.txt", "option-b.txt"] as const;
const CHOSEN = OPTIONS[1];

const waitMs = decisionWaitMinutes() * 60 * 1000;

/**
 * How an Agent waits on a Decision (spec §2.4): the Office tool's result tells it to end its turn,
 * and the user's answer arrives as the next message in the same long-lived `query()`, here after
 * the wait, by default past the 1-hour cache.
 */
export const decisionWaitCheck: Check = {
  id: "engine.decision-wait",
  title: "an Agent told by an Office tool to wait ends its turn, and an answer after the wait continues the work",
  slow: true,
  timeoutMs: waitMs + 10 * 60 * 1000,
  async run({ sandbox, startSession, signal }) {
    const repository = await sandbox.createRepository();
    for (const option of OPTIONS) {
      await writeFile(join(repository, option), `The ${option} the user picked.\n`);
    }
    const questions: string[] = [];
    const session = await startSession({ repository, ...withOfficeTools([openDecisionTool(questions)]) });
    session.send(
      `You are working on a Task in ${repository}. First use the ${TOOL} tool to ask the user which of ${OPTIONS.join(" and ")} to read, ` +
        "and do what its result says. Once you have the user's answer, use the Read tool on the chosen file and reply with just DONE.",
    );
    await session.nextResult();
    await delay(waitMs, undefined, { signal });
    session.send(`The user answered the Decision: ${CHOSEN}.`);
    const answerResult = await session.nextResult();

    const [decisionTurn = [], answerTurn = []] = turns(session.messages);
    const lastDecisionRequest = requestUsages(decisionTurn).at(-1);
    const firstAnswerRequest = requestUsages(answerTurn)[0];
    return {
      decisionOpened: questions.length > 0,
      toolCallsAfterDecisionInItsTurn: sortedNames(callsAfter(officeToolName(TOOL), toolCalls(decisionTurn)).map((call) => call.name)),
      waitedPastOneHour: waitMs > ONE_HOUR_MS,
      answerTurn: {
        sameSession: answerResult.session_id === session.sessionId,
        readOfChosenFile: lastOutcome(callsOn(toolCalls(answerTurn), "Read", join(repository, CHOSEN))),
        readsEarlierTurnsFromCache:
          lastDecisionRequest !== undefined && firstAnswerRequest !== undefined && readsEarlierPromptFromCache(lastDecisionRequest, firstAnswerRequest),
      },
    };
  },
};

function openDecisionTool(questions: string[]) {
  return tool(
    TOOL,
    "Opens a Decision on the Task: a question with options for the user.",
    { question: z.string(), options: z.array(z.string()) },
    async ({ question }) => {
      questions.push(question);
      return textResult("The Decision is open and waits for the user. End your turn now, with no further tool calls; the user's answer arrives as your next message.");
    },
  );
}

function callsAfter<T extends { readonly name: string }>(name: string, calls: readonly T[]): T[] {
  const index = calls.findIndex((call) => call.name === name);
  return index === -1 ? [] : calls.slice(index + 1);
}

function decisionWaitMinutes(): number {
  const configured = process.env[DECISION_WAIT_VARIABLE];
  if (configured === undefined || configured === "") {
    return DEFAULT_DECISION_WAIT_MINUTES;
  }
  const minutes = Number(configured);
  if (!Number.isFinite(minutes) || minutes < 0) {
    throw new Error(`${DECISION_WAIT_VARIABLE} must be a number of minutes, not "${configured}"`);
  }
  return minutes;
}
