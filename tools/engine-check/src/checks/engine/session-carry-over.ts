import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { execFile } from "node:child_process";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { CheckSkipped, type Check, type CheckContext, type Observation } from "../../check.ts";
import { pinnedBinaryPath } from "../../claude-code-p/pinned-binary.ts";
import type { RecordedSession } from "../../recorded-session.ts";
import { carrySessionBetweenFolders } from "../../session-carry-over.ts";
import { sessionEnvironment } from "../../session-environment.ts";
import { isWithin } from "../paths.ts";
import { toolCalls } from "../tool-calls.ts";
import { turnEnding } from "./running-command.ts";

/** The account the other checks run on: the environment drops `CLAUDE_CONFIG_DIR`, so the default. */
const FIRST_FOLDER = join(homedir(), ".claude");
const SECOND_FOLDER_VARIABLE = "ENGINE_CHECK_SECOND_CLAUDE_CONFIG";
const STATUS_TIMEOUT_MS = 30_000;

const CODE_WORD = "AMBER-41";
const SUB_AGENT_WORD = "sub-agent-73";
const LAST_LINE_WORD = "TAIL-58";
const COMMAND = "node long-output.mjs";

/** About 120 KB of output, past what the engine gives the model whole, so it saves the result to a file. */
const LONG_OUTPUT_SCRIPT = `for (let line = 1; line <= 3000; line++) {
  console.log(\`filler line \${line} of the long output, nothing to remember here\`);
}
console.log("The last line holds ${LAST_LINE_WORD}.");
`;

const TURN_ONE =
  `Remember the code word ${CODE_WORD}. Then make exactly these two calls, in this order. ` +
  `1. Run \`${COMMAND}\` with the Bash tool, exactly that command. ` +
  '2. Start a sub-agent with the Agent tool (subagent_type: "general-purpose", model: "haiku", ' +
  `description: "Say the word") whose prompt is: Reply with just the word ${SUB_AGENT_WORD}. ` +
  "Do not call any tool. Then reply with just OK.";

const TURN_TWO =
  "Answer three things from this conversation. 1. The code word I gave you at the start. " +
  "2. The word the sub-agent answered. 3. The last line of the earlier command's output: its result " +
  "named the file its full output was saved to; read the end of that file with the Read tool. " +
  "Reply in one line as: <code word> | <sub-agent's word> | <last line>.";

/** How a check starts a session on its route, in the account's folder or, with `configFolder`, another's. */
type Start = (
  context: CheckContext,
  spec: { readonly repository: string; readonly resume?: string; readonly configFolder?: string },
) => Promise<RecordedSession>;

/**
 * A session carried to a Stand-in Engine's account, as The Office carries one when a Stage's
 * engine refuses a turn for a used-up usage window (spec §5.4): a first turn in the account the
 * other checks run on, with a saved tool result and a Sub-agent; the session carried to the second
 * folder by the tool's copy of the service's carry-over; then resumed there, asked for what only
 * the earlier turn, the Sub-agent's answer and the saved result hold. Guards against a Claude Code
 * update changing where a session's files are or how a resume finds them. Skipped without a second
 * signed-in folder (`--second-claude-config`).
 */
export const sessionCarryOverCheck: Check = {
  id: "engine.session-carry-over",
  title:
    "a session carried to another account's config folder resumes there with its turns, Sub-agent and saved tool result",
  timeoutMs: 6 * 60 * 1000,
  run: (context) =>
    observeCarryOver(context, ({ startSession }, { repository, resume, configFolder }) =>
      startSession({
        repository,
        ...(resume === undefined ? {} : { resume }),
        ...(configFolder === undefined
          ? {}
          : { options: { env: { ...sessionEnvironment(), CLAUDE_CONFIG_DIR: configFolder } } }),
      }),
    ),
};

/** The same on the `-p` fallback. */
export const fallbackSessionCarryOverCheck: Check = {
  id: "fallback.session-carry-over",
  title:
    "a session carried to another account's config folder resumes there on -p with its turns, Sub-agent and saved tool result",
  timeoutMs: 6 * 60 * 1000,
  run: (context) =>
    observeCarryOver(context, ({ startClaudeCodePSession }, { repository, resume, configFolder }) =>
      startClaudeCodePSession({
        repository,
        ...(resume === undefined ? {} : { resume }),
        ...(configFolder === undefined ? {} : { environment: { CLAUDE_CONFIG_DIR: configFolder } }),
      }),
    ),
};

async function observeCarryOver(context: CheckContext, start: Start): Promise<Observation> {
  const secondFolder = context.secondClaudeConfig;
  if (secondFolder === undefined) {
    throw new CheckSkipped(
      `No second Claude Code folder: give a signed-in one with --second-claude-config <folder> or ${SECOND_FOLDER_VARIABLE}`,
    );
  }
  if (!(await signedIn(secondFolder))) {
    throw new CheckSkipped(
      `The Claude Code folder ${secondFolder} is not signed in: sign it in with CLAUDE_CONFIG_DIR=<folder> claude auth login`,
    );
  }
  const repository = await context.sandbox.createRepository();
  await writeFile(join(repository, "long-output.mjs"), LONG_OUTPUT_SCRIPT);

  const first = await start(context, { repository });
  first.send(TURN_ONE);
  const turnOne = await first.nextResult();
  await first.close();
  const { sessionId } = first;
  const written = await sessionFiles(FIRST_FOLDER, sessionId);

  try {
    const carried = await carrySessionBetweenFolders(sessionId, FIRST_FOLDER, secondFolder);
    const carriedFiles = await sessionFiles(secondFolder, sessionId);
    const resumed = await start(context, {
      repository,
      resume: sessionId,
      configFolder: secondFolder,
    });
    resumed.send(TURN_TWO);
    const turnTwo = await resumed.nextResult();
    await resumed.close();
    const answer = turnTwo.subtype === "success" ? turnTwo.result : "";
    return {
      turnOneEnded: turnEnding(turnOne),
      written: counted(written),
      carried,
      carriedFiles: counted(carriedFiles),
      firstFolderLeftInCarried: await namesFolder(carriedFiles.jsonl, FIRST_FOLDER),
      resumedSameSession: turnTwo.session_id === sessionId,
      turnTwoEnded: turnEnding(turnTwo),
      recallsTurnOne: answer.includes(CODE_WORD),
      recallsSubAgentAnswer: answer.includes(SUB_AGENT_WORD),
      readsSavedToolResult: answer.includes(LAST_LINE_WORD),
      savedToolResultReadFrom: readFrom(resumed.messages, secondFolder),
    };
  } finally {
    await removeSession(secondFolder, sessionId);
  }
}

interface SessionFiles {
  readonly transcripts: readonly string[];
  readonly subAgentTranscripts: readonly string[];
  readonly toolResults: readonly string[];
  /** The transcripts, the session's and its Sub-agents'. */
  readonly jsonl: readonly string[];
}

/** What a config folder holds of the session, under any `projects/<name>/`. */
async function sessionFiles(configFolder: string, sessionId: string): Promise<SessionFiles> {
  const transcripts: string[] = [];
  const subAgentTranscripts: string[] = [];
  const toolResults: string[] = [];
  for (const project of await names(join(configFolder, "projects"))) {
    const folder = join(configFolder, "projects", project);
    if ((await names(folder)).includes(`${sessionId}.jsonl`)) {
      transcripts.push(join(folder, `${sessionId}.jsonl`));
    }
    const subagents = join(folder, sessionId, "subagents");
    for (const name of await names(subagents)) {
      if (name.endsWith(".jsonl")) subAgentTranscripts.push(join(subagents, name));
    }
    const results = join(folder, sessionId, "tool-results");
    toolResults.push(...(await names(results)).map((name) => join(results, name)));
  }
  return {
    transcripts,
    subAgentTranscripts,
    toolResults,
    jsonl: [...transcripts, ...subAgentTranscripts],
  };
}

/** Whether each kind of file is there, as counts vary with the model's calls. */
function counted({ transcripts, subAgentTranscripts, toolResults }: SessionFiles): Observation {
  return {
    transcript: transcripts.length > 0,
    subAgentTranscript: subAgentTranscripts.length > 0,
    savedToolResult: toolResults.length > 0,
  };
}

/** Whether any of `files` still names `folder`, as a POSIX path or a Windows path inside JSON. */
async function namesFolder(files: readonly string[], folder: string): Promise<boolean> {
  const forms = [
    folder.replaceAll("\\", "/"),
    folder.replaceAll("/", "\\").replaceAll("\\", "\\\\"),
  ];
  for (const file of files) {
    const text = await readFile(file, "utf8");
    if (forms.some((form) => text.includes(form))) return true;
  }
  return false;
}

/** Where the resumed session read a saved tool result from, by its Read calls. */
function readFrom(messages: readonly SDKMessage[], secondFolder: string): string {
  const paths = toolCalls(messages)
    .filter(({ name }) => name === "Read")
    .map(({ input }) => String(input["file_path"] ?? ""))
    .filter((path) => path.includes("tool-results"));
  if (paths.length === 0) return "not read";
  if (paths.some((path) => isWithin(path, secondFolder))) return "the second folder";
  if (paths.some((path) => isWithin(path, FIRST_FOLDER))) return "the first folder";
  return "elsewhere";
}

/** Removes what the check left of the session in the second folder. */
async function removeSession(configFolder: string, sessionId: string): Promise<void> {
  for (const project of await names(join(configFolder, "projects"))) {
    const folder = join(configFolder, "projects", project);
    await rm(join(folder, `${sessionId}.jsonl`), { force: true });
    await rm(join(folder, sessionId), { recursive: true, force: true });
  }
  for (const name of await names(join(configFolder, "todos"))) {
    if (name.startsWith(`${sessionId}-`))
      await rm(join(configFolder, "todos", name), { force: true });
  }
  for (const kept of ["file-history", "session-env"]) {
    await rm(join(configFolder, kept, sessionId), { recursive: true, force: true });
  }
}

async function names(folder: string): Promise<string[]> {
  return readdir(folder).catch(() => []);
}

/** Whether `claude auth status` says the folder is signed in: it exits 1 when it isn't. */
function signedIn(configFolder: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(
      pinnedBinaryPath(),
      ["auth", "status", "--json"],
      {
        env: { ...sessionEnvironment(), CLAUDE_CONFIG_DIR: configFolder },
        timeout: STATUS_TIMEOUT_MS,
        windowsHide: true,
      },
      (error) => resolve(error === null),
    );
  });
}
