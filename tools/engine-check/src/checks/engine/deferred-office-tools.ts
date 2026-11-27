import { tool, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { Check, Observation } from "../../check.ts";
import type { OfficeTool } from "../../claude-code-p/office-tool-server.ts";
import { officeToolName } from "../../office-options.ts";
import { deferredAtStart, readTranscript } from "../../transcripts.ts";
import { toolCalls } from "../tool-calls.ts";
import { readsEarlierPromptFromCache, requestUsages, turns } from "./requests.ts";
import { textResult, withOfficeTools } from "./office-tools.ts";

const LOADED_TOOL = "loaded_note";
const DEFERRED_TOOL = "deferred_note";
const LOADED_WORD = "one";
const DEFERRED_WORD = "two";

const FIRST_TURN = `Call the ${LOADED_TOOL} tool once with the word "${LOADED_WORD}". Then reply with just OK.`;
const SECOND_TURN =
  `Load the ${DEFERRED_TOOL} tool with ToolSearch, using the query "select:${officeToolName(DEFERRED_TOOL)}", ` +
  `call it once with the word "${DEFERRED_WORD}", then reply with just OK.`;

/** The session's two turns, as both routes run them. */
interface DeferredSession {
  readonly sessionId: string;
  readonly repository: string;
  readonly messages: SDKMessage[];
  send(text: string): void;
  nextResult(): Promise<unknown>;
}

/**
 * Claude Code defers the Office tools of the areas a session isn't started with (spec 5.4.1 ›
 * Loading by area): one tool is always loaded and one carries no mark. The first turn calls the
 * loaded tool; the second loads the deferred one with `ToolSearch` and calls it. The facts: the
 * deferred tool is out of the session's tool list at the start, its call reaches its handler with
 * the input the model gave, and the second turn reads the first turn's prompt from the cache, so
 * loading it left the cached prefix as it was. A tool is listed at the start when `init` names it
 * and the engine didn't announce it as deferred: `init.tools` names deferred tools too.
 */
async function observe(
  session: DeferredSession,
  received: { loaded: string[]; deferred: string[] },
): Promise<Observation> {
  session.send(FIRST_TURN);
  await session.nextResult();
  session.send(SECOND_TURN);
  await session.nextResult();

  const calls = toolCalls(session.messages);
  const search = calls.findIndex(({ name }) => name === "ToolSearch");
  const deferredCall = calls.findIndex(({ name }) => name === officeToolName(DEFERRED_TOOL));
  const [first, second] = turns(session.messages);
  const lastOfFirst = requestUsages(first ?? []).at(-1);
  const firstOfSecond = requestUsages(second ?? [])[0];
  const deferred = deferredAtStart(await readTranscript(session.repository, session.sessionId));
  const startTools = initTools(session.messages).filter((name) => !deferred.includes(name));
  return {
    loadedToolListedAtStart: startTools.includes(officeToolName(LOADED_TOOL)),
    deferredToolListedAtStart: startTools.includes(officeToolName(DEFERRED_TOOL)),
    loadedCallReachedHandler: received.loaded.join() === LOADED_WORD,
    toolSearchBeforeDeferredCall: search !== -1 && deferredCall > search,
    deferredCallReachedHandler: received.deferred.join() === DEFERRED_WORD,
    secondTurnReadsFirstTurnsPromptFromCache:
      lastOfFirst !== undefined &&
      firstOfSecond !== undefined &&
      readsEarlierPromptFromCache(lastOfFirst, firstOfSecond),
  };
}

function initTools(messages: readonly SDKMessage[]): readonly string[] {
  const init = messages.find((message) => message.type === "system" && message.subtype === "init");
  return init?.type === "system" && init.subtype === "init" ? init.tools : [];
}

export const deferredOfficeToolsCheck: Check = {
  id: "office-tools.deferred",
  title:
    "a deferred Office tool from createSdkMcpServer() loads with ToolSearch and keeps the cache",
  async run({ sandbox, startSession }) {
    const repository = await sandbox.createRepository();
    const received = { loaded: [] as string[], deferred: [] as string[] };
    const session = await startSession({
      repository,
      ...withOfficeTools([noteTool(LOADED_TOOL, received.loaded)], true, [
        noteTool(DEFERRED_TOOL, received.deferred),
      ]),
    });
    return observe(session, received);
  },
};

export const deferredOfficeToolsPCheck: Check = {
  id: "office-tools.deferred-p",
  title:
    "a deferred Office tool served through the -p stream loads with ToolSearch and keeps the cache",
  async run({ sandbox, startClaudeCodePSession }) {
    const repository = await sandbox.createRepository();
    const received = { loaded: [] as string[], deferred: [] as string[] };
    const session = await startClaudeCodePSession({
      repository,
      officeTools: [
        streamedNoteTool(LOADED_TOOL, received.loaded, false),
        streamedNoteTool(DEFERRED_TOOL, received.deferred, true),
      ],
    });
    return observe(session, received);
  },
};

function noteTool(name: string, words: string[]) {
  return tool(name, `Takes a note: ${name}.`, { word: z.string() }, async ({ word }) => {
    words.push(word);
    return textResult("Noted.");
  });
}

function streamedNoteTool(name: string, words: string[], deferred: boolean): OfficeTool {
  return {
    name,
    description: `Takes a note: ${name}.`,
    input: { word: z.string() },
    deferred,
    run: async ({ word }) => {
      words.push(String(word));
      return "Noted.";
    },
  };
}
