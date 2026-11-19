import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname } from "node:path";
import type { CodexWireProcess } from "./codex-engine.js";
import type { CodexWireDirection, CodexWireTap } from "./codex-rpc.js";

/**
 * A recording of what went between the Codex engine and its app-servers, for a stand-in to replay:
 * one JSON line per message, in order, `{ process, direction, message }`. `process` counts the
 * app-servers of the recording from 1 (a session's Stop and resume start another); `direction` is
 * `to-app-server` or `from-app-server`; `message` is the JSON-RPC message with what differs run to
 * run named by placeholder (`WIRE_PLACEHOLDERS`): the places, the session's id, the MCP endpoint's
 * address, each thread and turn by its order (`<thread-1>`, `<turn-1>`, …) and each timestamp. A
 * line that isn't JSON is kept as `{ process, direction, text }`.
 */
export interface CodexWireLine {
  readonly process: number;
  readonly direction: CodexWireDirection;
  readonly message?: unknown;
  readonly text?: string;
}

export const WIRE_PLACEHOLDERS = {
  /** The session's temporary folder, where the Office tools write for it. */
  temporaryFolder: "<session-temp>",
  /** The session's folder, the thread's `cwd`. */
  folder: "<folder>",
  /** The engine's folder, `CODEX_HOME`. */
  codexHome: "<codex-home>",
  officeData: "<office-data>",
  home: "<home>",
  temp: "<temp>",
  sessionId: "<session-id>",
  /** `http://127.0.0.1:<port>`, the session's MCP endpoint, before each server's path. */
  endpoint: "<mcp-endpoint>",
  /** The session's MCP endpoint token, in each server's `Authorization` header. */
  mcpToken: "<mcp-token>",
  timestamp: "<timestamp>",
  /** The engine folder's own id, which Codex made in it. */
  installationId: "<installation-id>",
} as const;

/** The ids a recording numbers in the order they first come. */
const NUMBERED_IDS = { thread: "thread", turn: "turn" } as const;

/** Keys holding a thread's or a turn's id, beside a `thread` or `turn` object's own `id`. */
const ID_KEYS: Readonly<Record<string, keyof typeof NUMBERED_IDS>> = {
  threadId: "thread",
  turnId: "turn",
  expectedTurnId: "turn",
};

const ENDPOINT = /http:\/\/127\.0\.0\.1:\d+/g;

/** Keys of a moment in time; a window's reset is kept, as a replay reads it as it was. */
const TIMESTAMP_KEY = /(At|AtMs|Time|timestamp)$/;
const KEPT_TIMESTAMPS: ReadonlySet<string> = new Set(["resetsAt"]);

interface TappedLine {
  readonly process: number;
  readonly places: CodexWireProcess;
  readonly direction: CodexWireDirection;
  readonly line: string;
}

/**
 * Taps every app-server the engine starts (`CodexEngineSetup.wire`) and writes what went between
 * them as `CodexWireLine`s. Also tells which threads were started, for a live test to delete.
 */
export class CodexWireRecorder {
  private readonly lines: TappedLine[] = [];
  private processes = 0;
  /** Whether `save` wrote it. */
  saved = false;

  readonly tap = (places: CodexWireProcess): CodexWireTap => {
    const process = ++this.processes;
    return (direction, line) => this.lines.push({ process, places, direction, line });
  };

  /** Every thread an app-server answered `thread/start` with, by its real id. */
  get startedThreads(): string[] {
    const requests = new Map<string, string>();
    const started: string[] = [];
    for (const { process, direction, line } of this.lines) {
      const message = parsed(line) as
        { id?: unknown; method?: unknown; result?: { thread?: { id?: unknown } } } | undefined;
      if (message === undefined) continue;
      const key = `${process}/${String(message.id)}`;
      if (direction === "to-app-server" && message.method === "thread/start") {
        requests.set(key, "thread/start");
      } else if (direction === "from-app-server" && requests.get(key) === "thread/start") {
        const id = message.result?.thread?.id;
        if (typeof id === "string") started.push(id);
      }
    }
    return started;
  }

  /** The recording so far, with its placeholders. */
  recorded(): CodexWireLine[] {
    const numbered = new Map<string, string>();
    const counts = { thread: 0, turn: 0 };
    const number = (kind: keyof typeof NUMBERED_IDS, id: string): string => {
      const known = numbered.get(id);
      if (known !== undefined) return known;
      counts[kind] += 1;
      const placeholder = `<${NUMBERED_IDS[kind]}-${counts[kind]}>`;
      numbered.set(id, placeholder);
      return placeholder;
    };
    return this.lines.map(({ process, places, direction, line }) => {
      const message = parsed(line);
      if (message === undefined) {
        return { process, direction, text: inStrings(line, places, numbered) };
      }
      const withIds = numberedIds(message, number);
      return { process, direction, message: placeheld(withIds, places, numbered) };
    });
  }

  async save(file: string): Promise<void> {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(
      file,
      this.recorded()
        .map((line) => `${JSON.stringify(line)}\n`)
        .join(""),
    );
    this.saved = true;
  }
}

/** Reads a recording `CodexWireRecorder.save` wrote. */
export async function readWireRecording(file: string): Promise<CodexWireLine[]> {
  return (await readFile(file, "utf8"))
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as CodexWireLine);
}

function parsed(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

/** Each thread's and turn's id numbered, first in the order they come. */
function numberedIds(
  value: unknown,
  number: (kind: keyof typeof NUMBERED_IDS, id: string) => string,
  key?: string,
): unknown {
  if (Array.isArray(value)) return value.map((item) => numberedIds(item, number));
  if (typeof value === "string") {
    const kind = key === undefined ? undefined : ID_KEYS[key];
    return kind === undefined ? value : number(kind, value);
  }
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([name, item]) => {
      if ((name === "thread" || name === "turn") && isObjectWithId(item)) {
        const kind = name;
        return [name, { ...(numberedIds(item, number) as object), id: number(kind, item.id) }];
      }
      return [name, numberedIds(item, number, name)];
    }),
  );
}

function isObjectWithId(value: unknown): value is { id: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string"
  );
}

function placeheld(
  value: unknown,
  places: CodexWireProcess,
  numbered: ReadonlyMap<string, string>,
  key?: string,
): unknown {
  if (key === "installationId" && typeof value === "string")
    return WIRE_PLACEHOLDERS.installationId;
  if (key === "Authorization" && typeof value === "string") {
    return `Bearer ${WIRE_PLACEHOLDERS.mcpToken}`;
  }
  if (key !== undefined && TIMESTAMP_KEY.test(key) && !KEPT_TIMESTAMPS.has(key)) {
    if (typeof value === "number" || typeof value === "string") return WIRE_PLACEHOLDERS.timestamp;
  }
  if (typeof value === "string") return inStrings(value, places, numbered);
  if (Array.isArray(value)) return value.map((item) => placeheld(item, places, numbered));
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([name, item]) => [
      inStrings(name, places, numbered),
      placeheld(item, places, numbered, name),
    ]),
  );
}

/**
 * The places named by placeholder, the most specific first, as each may lie in the next: the
 * session's temporary folder and its folder in the temporary folder, the engine's folder in the
 * data directory, which may lie in the home folder. A Windows path in either separator.
 */
function inStrings(
  text: string,
  places: CodexWireProcess,
  numbered: ReadonlyMap<string, string>,
): string {
  const replacements: [string, string][] = [
    [places.temporaryFolder, WIRE_PLACEHOLDERS.temporaryFolder],
    [places.folder, WIRE_PLACEHOLDERS.folder],
    [places.codexHome, WIRE_PLACEHOLDERS.codexHome],
    [places.officeData, WIRE_PLACEHOLDERS.officeData],
    [tmpdir(), WIRE_PLACEHOLDERS.temp],
    [homedir(), WIRE_PLACEHOLDERS.home],
    [places.sessionId, WIRE_PLACEHOLDERS.sessionId],
  ];
  let replaced = text.replace(ENDPOINT, WIRE_PLACEHOLDERS.endpoint);
  for (const [search, placeholder] of replacements) {
    for (const spelling of new Set([search, search.replaceAll("\\", "/")])) {
      if (spelling !== "") replaced = replaced.replaceAll(spelling, placeholder);
    }
  }
  // An id inside a longer text, such as a rollout's file name; never inside its own placeholder.
  for (const [id, placeholder] of numbered) {
    replaced = replaced.replace(
      new RegExp(`(?<![\\w<])${escaped(id)}(?![\\w>])`, "g"),
      placeholder,
    );
  }
  return replaced;
}

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
