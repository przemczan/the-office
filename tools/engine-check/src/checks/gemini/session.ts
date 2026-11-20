import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Check } from "../../check.ts";
import { GeminiAcpSession } from "../../gemini/acp-session.ts";
import type { GeminiToolCall } from "../../gemini/gemini-session.ts";
import { CREDENTIAL_FILES, readSignInRecord } from "../../gemini/gemini-home.ts";
import { GEMINI_CHECK_MODEL } from "../../gemini/options.ts";
import { pinnedCliVersion } from "../../gemini/pinned-cli.ts";
import type { Json } from "../../json.ts";
import {
  cliFlags,
  anyFileHolds,
  fileWritten,
  nodeCommand,
  onBothTransports,
  sortedUnique,
  startIn,
  turnOutcome,
  writeFileLaterCommand,
} from "./helpers.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const REPOSITORY_WORD = "HERON-31";
const PARENT_WORD = "OTTER-58";
const SAY_OK = "Reply with just OK.";

const KEY_PROBE = nodeCommand("console.log(process.env.GEMINI_API_KEY ? 'KEY-SET' : 'KEY-UNSET')");

/**
 * The API-key sign-in the checks run on (spec §5.4 "Engines are a list"): the key goes to the CLI in
 * its environment only, so no file in the session's home holds it; whether the shell commands the
 * model runs see it; and a home without a key is refused.
 */
export const geminiApiKeyCheck: Check = {
  id: "gemini.api-key",
  title: "the CLI signs in with an API key from its environment, kept out of its folder",
  async run(context) {
    const observations = await onBothTransports(async (transport) => {
      const { session } = await startIn(context, transport);
      const turn = await session.prompt(
        `Run this shell command with run_shell_command, once: ${KEY_PROBE}\nThen reply with just its output.`,
      );
      const probe = session.toolCalls.find((call) => call.name === "run_shell_command");
      return {
        ...turnOutcome(turn),
        shellSeesKey: probe?.output.includes("KEY-SET") ?? null,
        keyInFilesLeft: await anyFileHolds(
          session.home,
          session.environment["GEMINI_API_KEY"] ?? "",
        ),
      };
    });
    const withoutKey = await startIn(context, "headless", {
      signIn: "none",
      refusedTurnsExpected: true,
    });
    const refused = await withoutKey.session.prompt(SAY_OK);
    return {
      ...observations,
      withoutKey: { ...turnOutcome(refused), exitCode: refused.exitCode ?? null },
    };
  },
};

/**
 * Login with Google on a personal account (Gemini Code Assist for individuals), the sign-in The Office
 * meant to offer with a pasted code: `--gemini-sign-in` noted whether it signed in with no terminal
 * and which files it left; a session in a home holding a copy of the two credential files shows
 * whether Google serves it. Skipped until the folder is signed in.
 */
export const geminiGoogleSignInCheck: Check = {
  id: "gemini.google-sign-in",
  title: "Login with Google with a pasted code, its files, and whether Google serves the CLI",
  async run(context) {
    const signIn = await readSignInRecord();
    const { session } = await startIn(context, "headless", {
      signIn: "google",
      refusedTurnsExpected: true,
    });
    const turn = await session.prompt(SAY_OK);
    return {
      signedInWithPipedStdin: signIn?.signedIn === true && signIn.stdinWasTerminal === false,
      credentialFilesInFolder: CREDENTIAL_FILES.every(
        (file) => signIn?.filesLeft.includes(file) ?? false,
      ),
      encryptedKeychainFile: signIn?.filesLeft.includes("gemini-credentials.json") ?? false,
      copiedFolder: turnOutcome(turn),
      refusedForIndividuals: /no longer supported for Gemini Code Assist for individuals/.test(
        turn.error?.message ?? "",
      ),
    };
  },
};

/**
 * What a session starts with on each transport: the version and the model answer, the session id's
 * form, what ACP's `initialize` and `session/new` declare, and which `GEMINI.md` files load (the
 * repository's and the one above it).
 */
export const geminiStartCheck: Check = {
  id: "gemini.start",
  title: "a session starts on the pinned CLI and model, and loads only the repository's GEMINI.md",
  async run(context) {
    const observations = await onBothTransports(async (transport) => {
      const repository = await context.sandbox.createRepository(`repository-${transport}`);
      await writeFile(
        join(repository, "GEMINI.md"),
        `The repository's code word is ${REPOSITORY_WORD}.\n`,
      );
      await writeFile(
        join(dirname(repository), "GEMINI.md"),
        `The parent's code word is ${PARENT_WORD}.\n`,
      );
      const session = await context.startGeminiSession({ transport, repository });
      const turn = await session.prompt(
        "List every code word your instructions or context give you, separated by spaces, or reply NONE.",
      );
      const declared = session instanceof GeminiAcpSession ? acpDeclarations(session.start) : {};
      return {
        ...turnOutcome(turn),
        sessionIdIsUuid: UUID.test(session.sessionId),
        repositoryMemoryLoaded: turn.reply.includes(REPOSITORY_WORD),
        parentMemoryLoaded: turn.reply.includes(PARENT_WORD),
        ...declared,
      };
    });
    return { version: pinnedCliVersion(), model: GEMINI_CHECK_MODEL, ...observations };
  },
};

function acpDeclarations(start: GeminiAcpSession["start"]): Record<string, Json> {
  const initialize = (start?.initialize ?? {}) as {
    protocolVersion?: number;
    authMethods?: { id: string }[];
    agentCapabilities?: { loadSession?: boolean; mcpCapabilities?: Record<string, boolean> };
  };
  const session = (start?.session ?? {}) as {
    modes?: { availableModes?: { id: string }[]; currentModeId?: string };
  };
  return {
    protocolVersion: initialize.protocolVersion ?? null,
    loadSession: initialize.agentCapabilities?.loadSession ?? false,
    mcpCapabilities: sortedUnique(
      Object.entries(initialize.agentCapabilities?.mcpCapabilities ?? {})
        .filter(([, supported]) => supported)
        .map(([name]) => name),
    ),
    authMethods: sortedUnique((initialize.authMethods ?? []).map((method) => method.id)),
    modes: sortedUnique((session.modes?.availableModes ?? []).map((mode) => mode.id)),
    currentMode: session.modes?.currentModeId ?? null,
  };
}

const WORD = "MAPLE-77";

/** A later session resumes by id in the same home and folder, its history kept (ACP `session/load`, headless `--resume`). */
export const geminiResumeCheck: Check = {
  id: "gemini.resume",
  title: "a session resumes by its id with its history",
  async run(context) {
    return onBothTransports(async (transport) => {
      const first = await startIn(context, transport);
      await first.session.prompt(`Remember the code word ${WORD}. ${SAY_OK}`);
      await first.session.close();
      const resumed = await context.startGeminiSession({
        transport,
        repository: first.repository,
        home: first.session.home,
        resume: first.session.sessionId,
      });
      const turn = await resumed.prompt(
        "Which code word did I give you? Reply with just the word.",
      );
      return {
        ...turnOutcome(turn),
        historyKept: turn.reply.includes(WORD),
        ...(resumed instanceof GeminiAcpSession
          ? { historyReplayedOnLoad: (resumed.start?.replayed ?? 0) > 0 }
          : {}),
      };
    });
  },
};

const LONG_COMMAND_MS = 30_000;
const FINISHED = "finished.txt";

/**
 * Stop (spec §2.4): a 30 s command is stopped mid-run (ACP `session/cancel`, headless a stop of the
 * turn's process), the command doesn't run to its end, and the next turn answers.
 */
export const geminiInterruptCheck: Check = {
  id: "gemini.interrupt",
  title: "a stop ends the running turn and its command, and the next turn works",
  timeoutMs: 6 * 60 * 1000,
  async run(context) {
    return onBothTransports(async (transport) => {
      const { session, repository } = await startIn(context, transport);
      const startedAt = Date.now();
      const running = session.prompt(
        `Run this shell command with run_shell_command, exactly once, in the foreground (not in the background), and wait for it: ${writeFileLaterCommand(FINISHED, LONG_COMMAND_MS)}\nThen reply with just DONE.`,
      );
      await session.waitForToolCall((call) => call.name === "run_shell_command");
      await new Promise((resolve) => setTimeout(resolve, 2000));
      await session.cancel();
      const stopped = await running;
      const stoppedAfterMs = Date.now() - startedAt;
      await new Promise((resolve) =>
        setTimeout(resolve, Math.max(0, LONG_COMMAND_MS + 3000 - (Date.now() - startedAt))),
      );
      const next = await session.prompt(SAY_OK);
      return {
        stopped: turnOutcome(stopped),
        stoppedBeforeTheCommandEnded: stoppedAfterMs < LONG_COMMAND_MS,
        commandRanToItsEnd: fileWritten(repository, FINISHED),
        ranInBackground: session.toolCalls.some(movedToBackground),
        nextTurn: turnOutcome(next),
      };
    });
  },
};

/**
 * Barge-in (spec §2.4): a message sent while a turn runs. Over ACP a second `session/prompt` during
 * the first; headless has no input while its process runs, which the CLI's flags show.
 */
export const geminiBargeInCheck: Check = {
  id: "gemini.barge-in",
  title: "a message sent during a turn lands, waits or is refused",
  async run(context) {
    const { session } = await startIn(context, "acp");
    const first = session.prompt(
      `Run this shell command with run_shell_command, exactly once, in the foreground (not in the background), and wait for it: ${writeFileLaterCommand("first.txt", 10_000)}\nThen reply with just FIRST.`,
    );
    await session.waitForToolCall((call) => call.name === "run_shell_command");
    const second = await session.prompt("Reply with just SECOND.");
    const firstTurn = await first;
    const flags = await cliFlags(join(context.sandbox.root, "help-home"));
    return {
      acp: {
        firstTurn: turnOutcome(firstTurn),
        secondTurn: turnOutcome(second),
        secondAnswered: second.reply.includes("SECOND"),
        firstCallRanInBackground: session.toolCalls.some(movedToBackground),
        firstToolCall:
          session.toolCalls.find((call) => call.name === "run_shell_command")?.status ?? "none",
      },
      headless: { inputFormatFlag: flags.includes("--input-format") },
    };
  },
};

/** The shell tool can move a command to the background, which ends its call at once. */
function movedToBackground(call: GeminiToolCall): boolean {
  return call.name === "run_shell_command" && /moved to background/i.test(call.output);
}
