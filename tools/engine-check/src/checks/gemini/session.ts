import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { CheckSkipped, type Check } from "../../check.ts";
import type { GeminiSession, GeminiToolCall, GeminiTurn } from "../../gemini/gemini-session.ts";
import {
  GEMINI_API_KEY_VARIABLE,
  GEMINI_CHECK_MODEL,
  mcpToolName,
  OFFICE_SERVER,
} from "../../gemini/options.ts";
import { pinnedCliVersion } from "../../gemini/pinned-cli.ts";
import {
  anyFileHolds,
  answeringTool,
  fileWritten,
  nodeCommand,
  startIn,
  turnOutcome,
  wait,
  writeFileLaterCommand,
} from "./helpers.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const REPOSITORY_WORD = "HERON-31";
const PARENT_WORD = "OTTER-58";
const INSTRUCTIONS_WORD = "BIRCH-42";
const SAY_OK = "Reply with just OK.";
const KEY_PROBE = nodeCommand(
  `console.log(process.env.${GEMINI_API_KEY_VARIABLE} ? 'KEY-SET' : 'KEY-UNSET')`,
);

/**
 * What a session starts with on the adapter's wiring: the version and the model answer, the session
 * id's form, which instructions load (the Agent's file in the engine folder, the repository's
 * `GEMINI.md`, the one above it), whether the model's shell commands see the API key the CLI runs
 * with, whether any file left holds it, and a turn without a key.
 */
export const geminiStartCheck: Check = {
  id: "gemini.start",
  title:
    "a session starts on the pinned CLI and model, with its instructions and its key kept out of reach",
  async run(context) {
    const repository = await context.sandbox.createRepository("repository-start");
    await writeFile(
      join(repository, "GEMINI.md"),
      `The repository's code word is ${REPOSITORY_WORD}.\n`,
    );
    await writeFile(
      join(dirname(repository), "GEMINI.md"),
      `The parent's code word is ${PARENT_WORD}.\n`,
    );
    const session = await context.startGeminiSession({
      repository,
      instructions: `Your instructions' code word is ${INSTRUCTIONS_WORD}.\n`,
    });
    const turn = await session.prompt(
      [
        `Run this shell command with run_shell_command, once: ${KEY_PROBE}`,
        "Then reply with its output, followed by every code word your instructions or context give you, separated by spaces.",
      ].join("\n"),
    );
    const probe = session.toolCalls.find((call) => call.name === "run_shell_command");
    const key = session.environment[GEMINI_API_KEY_VARIABLE] ?? "";
    await session.close();
    const withoutKey = await startIn(context, {
      withoutApiKey: true,
      refusedTurnsExpected: true,
    });
    const refused = await withoutKey.session.prompt(SAY_OK);
    return {
      version: pinnedCliVersion(),
      model: GEMINI_CHECK_MODEL,
      ...turnOutcome(turn),
      sessionIdIsUuid: UUID.test(session.sessionId),
      instructionsLoaded: turn.reply.includes(INSTRUCTIONS_WORD),
      repositoryMemoryLoaded: turn.reply.includes(REPOSITORY_WORD),
      parentMemoryLoaded: turn.reply.includes(PARENT_WORD),
      shellSeesKey: probe === undefined ? null : probe.output.includes("KEY-SET"),
      keyInFilesLeft:
        key !== "" &&
        ((await anyFileHolds(context.sandbox.officeData, key)) ||
          (await anyFileHolds(repository, key))),
      withoutKey: { ...turnOutcome(refused), exitCode: refused.exitCode },
    };
  },
};

const WORD = "MAPLE-77";
const ASK_FOR_WORD = "Which code word did I give you? Reply with just the word.";

/**
 * A later session resumes by id in the same engine folder and repository, its history kept; and
 * what resuming the id in another engine's folder does (spec §5.4.7: no session carry).
 */
export const geminiResumeCheck: Check = {
  id: "gemini.resume",
  title: "a session resumes by its id in its engine's folder, and not in another's",
  async run(context) {
    const first = await startIn(context);
    await first.session.prompt(`Remember the code word ${WORD}. ${SAY_OK}`);
    await first.session.close();
    const resumed = await context.startGeminiSession({
      repository: first.repository,
      resume: first.session.sessionId,
    });
    const turn = await resumed.prompt(ASK_FOR_WORD);
    await resumed.close();
    const elsewhere = await context.startGeminiSession({
      repository: first.repository,
      resume: first.session.sessionId,
      engineId: "gemini-cli-other",
      refusedTurnsExpected: true,
    });
    const elsewhereTurn = await elsewhere.prompt(ASK_FOR_WORD);
    return {
      ...turnOutcome(turn),
      historyKept: turn.reply.includes(WORD),
      otherEngineFolder: {
        ...turnOutcome(elsewhereTurn),
        historyKept: elsewhereTurn.reply.includes(WORD),
      },
    };
  },
};

const LONG_COMMAND_MS = 30_000;
const BACKGROUND_COMMAND_MS = 15_000;
const FINISHED = "finished.txt";
const BACKGROUND_FINISHED = "background.txt";

/**
 * Stop (spec §2.4) as the adapter does it: the turn's process tree is ended 2 s into a 30 s
 * foreground command, which doesn't run to its end, and the next turn answers. Then a command the
 * model runs in the background, and whether it outlives a turn that ends by itself, after which the
 * adapter ends what the turn's process left running.
 */
export const geminiInterruptCheck: Check = {
  id: "gemini.interrupt",
  title: "a stop ends the running turn and its command, and the next turn works",
  timeoutMs: 6 * 60 * 1000,
  async run(context) {
    const { session, repository } = await startIn(context);
    const startedAt = Date.now();
    const running = session.prompt(
      `Run this shell command with run_shell_command, exactly once, in the foreground (not in the background), and wait for it: ${writeFileLaterCommand(FINISHED, LONG_COMMAND_MS)}\nThen reply with just DONE.`,
    );
    await session.waitForToolCall((call) => call.name === "run_shell_command");
    await wait(2000);
    await session.cancel();
    const stopped = await running;
    const stoppedAfterMs = Date.now() - startedAt;
    await wait(Math.max(0, LONG_COMMAND_MS + 3000 - (Date.now() - startedAt)));
    const next = await session.prompt(SAY_OK);
    const background = await session.prompt(
      `Run this shell command with run_shell_command in the background (is_background true), once, and don't wait for it: ${writeFileLaterCommand(BACKGROUND_FINISHED, BACKGROUND_COMMAND_MS)}\nThen reply with just STARTED.`,
    );
    await wait(BACKGROUND_COMMAND_MS + 5000);
    return {
      stopped: turnOutcome(stopped),
      stoppedBeforeTheCommandEnded: stoppedAfterMs < LONG_COMMAND_MS,
      commandRanToItsEnd: fileWritten(repository, FINISHED),
      nextTurn: turnOutcome(next),
      backgroundTurn: turnOutcome(background),
      ranInBackground: background.toolCalls.some(ranInBackground),
      backgroundCommandOutlivedTurn: fileWritten(repository, BACKGROUND_FINISHED),
    };
  },
};

function ranInBackground(call: GeminiToolCall): boolean {
  const input = call.input;
  const asked =
    input !== null && typeof input === "object" && !Array.isArray(input)
      ? input["is_background"] === true
      : false;
  return call.name === "run_shell_command" && (asked || /background/i.test(call.output));
}

const REVIEW_TOOL = "ask_for_review";
const NEXT_WORD = "COMET-12";

/**
 * A message sent with priority `next` while an Office tool answers (the case that broke over a
 * `localhost` MCP endpoint on Windows): it doesn't land in the running turn, as a headless turn
 * takes no input, but waits and makes the next turn.
 */
export const geminiPriorityNextCheck: Check = {
  id: "gemini.priority-next",
  title: "a message sent while an Office tool answers waits for the next turn",
  async run(context) {
    let session: GeminiSession | undefined;
    let second: Promise<GeminiTurn> | undefined;
    const review = answeringTool(
      REVIEW_TOOL,
      "Asks the user to review the work so far.",
      "Reviewed.",
    );
    const reviewWhileAMessageArrives = {
      ...review,
      run: async (input: Parameters<typeof review.run>[0]) => {
        second ??= session?.prompt(`A note from the user: reply with just ${NEXT_WORD}.`);
        await wait(3000);
        return review.run(input);
      },
    };
    session = (await startIn(context, { officeTools: [reviewWhileAMessageArrives] })).session;
    const first = await session.prompt(
      `Call ${mcpToolName(OFFICE_SERVER, REVIEW_TOOL)} once, then reply with just OK.`,
    );
    const secondTurn = second === undefined ? undefined : await second;
    return {
      firstTurn: turnOutcome(first),
      officeToolAnswered: first.toolCalls.some(
        (call) =>
          call.name === mcpToolName(OFFICE_SERVER, REVIEW_TOOL) && call.status === "completed",
      ),
      landedInRunningTurn: first.messageCount > 1 || first.reply.includes(NEXT_WORD),
      secondTurn: secondTurn === undefined ? null : turnOutcome(secondTurn),
      secondTookTheNextTurn: secondTurn?.index === first.index + 1,
      secondAnswered: secondTurn?.reply.includes(NEXT_WORD) ?? false,
      turnsRun: session.turns.length,
    };
  },
};

const LATER_COMMAND_MS = 10_000;
const LATER_FINISHED = "later.txt";
const FIRST_LATER_WORD = "RIVER-63";
const SECOND_LATER_WORD = "STONE-85";

/**
 * Two messages sent with priority `later` while a 10 s command runs: the running turn goes on to its
 * end, and both make the next turn together.
 */
export const geminiPriorityLaterCheck: Check = {
  id: "gemini.priority-later",
  title: "messages sent during a turn wait for its end and make the next turn together",
  async run(context) {
    const { session, repository } = await startIn(context);
    const first = session.prompt(
      `Run this shell command with run_shell_command, exactly once, in the foreground (not in the background), and wait for it: ${writeFileLaterCommand(LATER_FINISHED, LATER_COMMAND_MS)}\nThen reply with just FIRST.`,
    );
    await session.waitForToolCall((call) => call.name === "run_shell_command");
    const secondA = session.prompt(`Remember the word ${FIRST_LATER_WORD}.`);
    const secondB = session.prompt(
      `Remember the word ${SECOND_LATER_WORD}, then reply with both words you were asked to remember.`,
    );
    const firstTurn = await first;
    const commandRanToItsEnd = fileWritten(repository, LATER_FINISHED);
    const [turnA, turnB] = await Promise.all([secondA, secondB]);
    return {
      firstTurn: turnOutcome(firstTurn),
      commandRanToItsEnd,
      nextTurn: turnOutcome(turnB),
      bothInOneTurn: turnA.index === turnB.index && turnB.messageCount === 2,
      bothAnswered:
        turnB.reply.includes(FIRST_LATER_WORD) && turnB.reply.includes(SECOND_LATER_WORD),
      turnsRun: session.turns.length,
    };
  },
};

/**
 * A turn refused because a quota is used up, and what its error names. Skipped unless the key's
 * quota is used up when it runs, as with a free-tier key run past its requests a minute.
 */
export const geminiQuotaRefusalCheck: Check = {
  id: "gemini.quota-refusal",
  title: "a turn refused for a used-up quota names its metric and when to retry",
  async run(context) {
    const { session } = await startIn(context, { refusedTurnsExpected: true });
    const turn = await session.prompt(SAY_OK);
    const message = `${turn.error?.code ?? ""} ${turn.error?.message ?? ""}`;
    if (turn.stopReason !== "error" || !/429|quota|RESOURCE_EXHAUSTED/i.test(message)) {
      throw new CheckSkipped("No quota is used up now: the turn wasn't refused for one.");
    }
    return {
      refused: true,
      namesMetric: /metric/i.test(message),
      namesRetry: /retry/i.test(message),
      exitCode: turn.exitCode,
    };
  },
};
