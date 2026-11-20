import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname } from "node:path";
import type {
  CopilotEvent,
  CopilotListedSkill,
  CopilotMessage,
  CopilotOfficeTool,
  CopilotRuntimeSession,
  CopilotSessionHandlers,
  CopilotSessionSpec,
  CopilotToolCall,
  CopilotToolDecision,
  OpenCopilotSession,
} from "./copilot-runtime.js";

/*
 * Recordings of what went between a Copilot CLI session and its runtimes, at the seam
 * (`OpenCopilotSession`), one JSONL line per step, each naming the runtime it was on (1 for the
 * first opened, 2 for a resume's): what the session asked of the runtime (`open`, `send`, `abort`,
 * `list-skills`, `close`) and what the runtime did (each event, each hook and permission question
 * with the answer given, each Office tool call with its answer, its exit). What differs run to run
 * is a placeholder: the session's id, its folder, the engine's folder, the temp folder and each
 * message's id. The token signing the runtime in is never recorded: a save holding it is refused.
 */

export type CopilotRecordingLine = { readonly runtime: number } & CopilotRecordingStep;

type CopilotRecordingStep =
  | { readonly step: "open"; readonly spec: RecordedSpec }
  | { readonly step: "event"; readonly event: CopilotEvent }
  | {
      readonly step: "pre-tool-use";
      readonly call: CopilotToolCall;
      decision?: CopilotToolDecision;
    }
  | { readonly step: "permission"; readonly toolCallId?: string; readonly approved: boolean }
  | {
      readonly step: "office-tool";
      readonly tool: string;
      readonly toolCallId: string;
      readonly args: unknown;
    }
  | {
      readonly step: "office-tool-answer";
      readonly toolCallId: string;
      readonly answer?: string;
      readonly error?: string;
    }
  | { readonly step: "send"; readonly message: RecordedMessage }
  | { readonly step: "abort" }
  | { readonly step: "list-skills"; readonly skills: readonly CopilotListedSkill[] }
  | { readonly step: "close" }
  | { readonly step: "closed" }
  | { readonly step: "exited"; readonly words: string };

/** What of a session's spec the replay holds the session to: all but its environment and token. */
type RecordedSpec = ReturnType<typeof recordedSpec>;

function recordedSpec(spec: CopilotSessionSpec) {
  return {
    sessionId: spec.sessionId,
    resume: spec.resume,
    home: spec.home,
    workingDirectory: spec.workingDirectory,
    model: spec.model,
    instructions: spec.instructions,
    skillDirectories: spec.skillDirectories,
    disabledSkills: spec.disabledSkills,
    availableTools: spec.availableTools,
    officeTools: spec.officeTools.map(({ name, description, parameters }) => ({
      name,
      description,
      parameters,
    })),
    // Only what the servers are: how they launch holds the checkout's own paths.
    mcpServers: Object.fromEntries(
      Object.entries(spec.mcpServers).map(([name, server]) => [
        name,
        { type: server.type ?? "stdio", tools: server.tools },
      ]),
    ),
  };
}

type RecordedMessage = Omit<CopilotMessage, "attachments"> & {
  readonly attachments: readonly unknown[];
};

const PLACES = {
  folder: "<folder>",
  home: "<home>",
  temp: "<temp>",
} as const;

const SESSION_ID = "<session-id>";

/** A placeholder in a recording: a place, the session's id, or a message's id, `<message-N>`. */
const PLACEHOLDER = /<(?:folder|home|temp|session-id|message-\d+)>/g;

/** A value as it stands inside a JSON string. */
function inJson(value: string): string {
  return JSON.stringify(value).slice(1, -1);
}

/**
 * Wraps the real `OpenCopilotSession` and records every step of every runtime it opens, in order.
 * `save` writes them so far to one JSONL file, the run's own values as placeholders.
 */
export class CopilotRecorder {
  private readonly lines: CopilotRecordingLine[] = [];
  /** Each run's own value with the placeholder it is saved as. */
  private readonly places = new Map<string, string>([[tmpdir(), PLACES.temp]]);
  private readonly secrets = new Set<string>();
  private runtimes = 0;
  private messages = 0;
  saved = false;

  constructor(private readonly open: OpenCopilotSession) {}

  readonly tap: OpenCopilotSession = async (spec, handlers) => {
    const runtime = ++this.runtimes;
    const record = <T extends CopilotRecordingStep>(step: T): T => {
      const line = { runtime, ...step };
      this.lines.push(line);
      return line;
    };
    if (spec.token !== undefined) this.secrets.add(spec.token);
    this.places.set(spec.workingDirectory, PLACES.folder);
    this.places.set(spec.home, PLACES.home);
    this.places.set(spec.sessionId, SESSION_ID);
    record({ step: "open", spec: recordedSpec(spec) });
    const recordedHandlers: CopilotSessionHandlers = {
      onEvent: (event) => {
        record({ step: "event", event });
        handlers.onEvent(event);
      },
      preToolUse: async (call) => {
        const line = record<Extract<CopilotRecordingStep, { step: "pre-tool-use" }>>({
          step: "pre-tool-use",
          call,
        });
        const decision = await handlers.preToolUse(call);
        line.decision = decision;
        return decision;
      },
      permissionRequested: (toolCallId) => {
        const approved = handlers.permissionRequested(toolCallId);
        record({
          step: "permission",
          ...(toolCallId === undefined ? {} : { toolCallId }),
          approved,
        });
        return approved;
      },
      runtimeExited: (words) => {
        record({ step: "exited", words });
        handlers.runtimeExited(words);
      },
    };
    const officeTools = spec.officeTools.map((tool): CopilotOfficeTool => ({
      ...tool,
      answer: async (args, toolCallId) => {
        record({ step: "office-tool", tool: tool.name, toolCallId, args });
        try {
          const answer = await tool.answer(args, toolCallId);
          record({ step: "office-tool-answer", toolCallId, answer });
          return answer;
        } catch (error) {
          record({ step: "office-tool-answer", toolCallId, error: messageOf(error) });
          throw error;
        }
      },
    }));
    const session = await this.open({ ...spec, officeTools }, recordedHandlers);
    return {
      get sessionId() {
        return session.sessionId;
      },
      send: (message) => {
        this.places.set(message.clientTurnId, `<message-${++this.messages}>`);
        record({ step: "send", message: { ...message, attachments: [...message.attachments] } });
        return session.send(message);
      },
      abort: () => {
        record({ step: "abort" });
        return session.abort();
      },
      listSkills: async () => {
        const skills = await session.listSkills();
        record({ step: "list-skills", skills });
        return skills;
      },
      close: async () => {
        record({ step: "close" });
        await session.close();
        record({ step: "closed" });
      },
    };
  };

  /** The recording so far, its run's own values as placeholders. */
  text(): string {
    // The longest first, as the session's folder is in the temp folder.
    const places = [...this.places].toSorted(([one], [other]) => other.length - one.length);
    const text = this.lines
      .flatMap(trimmed)
      .map((line) => {
        let json = JSON.stringify(line);
        for (const [value, placeholder] of places) {
          json = json.replaceAll(inJson(value), placeholder);
        }
        return json;
      })
      .join("\n");
    for (const secret of this.secrets) {
      if (text.includes(secret)) throw new Error("The recording holds the engine's token.");
    }
    return `${text}\n`;
  }

  async save(file: string): Promise<void> {
    const text = this.text();
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, text);
    this.saved = true;
  }
}

/**
 * A line as it is saved, without the bulk the session never reads: the runtime's own `model.*`
 * events (its telemetry of each model call, the whole conversation again), the runtime's system
 * message's text, and an answer's encrypted reasoning. Every other event stays whole.
 */
function trimmed(line: CopilotRecordingLine): CopilotRecordingLine[] {
  if (line.step !== "event") return [line];
  const { event } = line;
  if (event.type.startsWith("model.")) return [];
  if (event.type === "system.message") {
    const { contentBlocks: _blocks, ...data } = event.data as typeof event.data & {
      contentBlocks?: unknown;
    };
    return [{ ...line, event: { ...event, data: { ...data, content: LEFT_OUT } } }];
  }
  if (event.type === "assistant.message") {
    const { encryptedContent: _encrypted, reasoningOpaque: _opaque, ...data } = event.data;
    return [{ ...line, event: { ...event, data } }];
  }
  return [line];
}

const LEFT_OUT = "<left out of the recording>";

/** A call the session made of a stand-in runtime, waiting for the replay to answer it. */
interface SessionCall {
  readonly kind: "send" | "abort" | "list-skills" | "close";
  readonly message?: CopilotMessage;
  answer(value?: unknown): void;
  refuse(error: Error): void;
}

/**
 * Stand-in runtimes replaying a recording (`CopilotRecorder`), each open the recording's next
 * runtime, line by line, so the session's real code runs on it:
 * - what the session asks of the runtime is waited for and checked against the recording, its
 *   placeholders standing for this run's own values (learnt from the spec and each message);
 * - the runtime's events are delivered in order, and its hook and permission questions asked
 *   where it asked them, the session's answers checked against the recorded ones;
 * - an Office tool is called where the runtime called it, and its answer checked where it came;
 *   an MCP tool's result is the recorded one, as the runtime ran its server itself.
 * What the session does that the recording doesn't have ends the runtime with words naming the
 * line, which fail the session.
 */
export class CopilotReplay {
  private opened = 0;
  private readonly replayed = new Set<number>();
  private readonly bindings = new Map<string, string>([[PLACES.temp, tmpdir()]]);

  private constructor(
    private readonly file: string,
    private readonly lines: readonly (CopilotRecordingLine & { readonly lineNumber: number })[],
  ) {}

  static async of(file: string): Promise<CopilotReplay> {
    const lines = (await readFile(file, "utf8"))
      .split(/\r?\n/)
      .map((text, index) => ({ text, lineNumber: index + 1 }))
      .filter(({ text }) => text.trim() !== "")
      .map(({ text, lineNumber }) => ({
        ...(JSON.parse(text) as CopilotRecordingLine),
        lineNumber,
      }));
    return new CopilotReplay(file, lines);
  }

  /** The runtimes of the recording not replayed to their end. */
  unreplayed(): number[] {
    const runtimes = new Set(this.lines.map(({ runtime }) => runtime));
    return [...runtimes].filter((runtime) => !this.replayed.has(runtime));
  }

  readonly open: OpenCopilotSession = (spec, handlers) => {
    const runtime = ++this.opened;
    const lines = this.lines.filter((line) => line.runtime === runtime);
    const [first] = lines;
    const where = `The replay of ${basename(this.file)}, runtime ${runtime}`;
    if (first?.step !== "open") {
      return Promise.reject(new Error(`${where}: the recording opens no runtime ${runtime}.`));
    }
    this.bind(SESSION_ID, spec.sessionId);
    this.bind(PLACES.folder, spec.workingDirectory);
    this.bind(PLACES.home, spec.home);
    const problem = difference(
      "spec",
      this.restored(first.spec),
      JSON.parse(JSON.stringify(recordedSpec(spec))),
    );
    if (problem !== undefined) {
      return Promise.reject(new Error(`${where}: line ${first.lineNumber}: ${problem}`));
    }
    const calls = new SessionCalls();
    let ended: string | undefined;
    const stopped = (words: string): void => {
      if (ended !== undefined) return;
      ended = words;
      calls.refuseAll(new Error(words));
      handlers.runtimeExited(words);
    };
    const replaying = async (): Promise<void> => {
      try {
        await this.replay(where, lines.slice(1), spec, handlers, calls);
      } catch (error) {
        stopped(`${where}: ${messageOf(error)}`);
        return;
      }
      this.replayed.add(runtime);
      calls.finished = true;
      calls.refuseAll(new Error(`${where}: the recording has nothing more of this runtime.`));
    };
    void replaying();
    const call = (kind: SessionCall["kind"], message?: CopilotMessage): Promise<unknown> => {
      if (ended !== undefined) return Promise.reject(new Error(ended));
      if (calls.finished && kind !== "close") {
        return Promise.reject(new Error(`${where}: the recording has no ${kind} after its end.`));
      }
      if (calls.finished) return Promise.resolve();
      return calls.made(kind, message);
    };
    return Promise.resolve({
      sessionId: spec.sessionId,
      send: async (message) => {
        await call("send", message);
      },
      abort: async () => {
        await call("abort");
      },
      listSkills: () => call("list-skills") as Promise<readonly CopilotListedSkill[]>,
      close: async () => {
        await call("close").catch(() => undefined);
      },
    } satisfies CopilotRuntimeSession);
  };

  private async replay(
    where: string,
    lines: readonly (CopilotRecordingLine & { readonly lineNumber: number })[],
    spec: CopilotSessionSpec,
    handlers: CopilotSessionHandlers,
    calls: SessionCalls,
  ): Promise<void> {
    const officeToolAnswers = new Map<string, Promise<{ answer?: string; error?: string }>>();
    let closing: SessionCall | undefined;
    for (const line of lines) {
      const at = `line ${line.lineNumber}`;
      const fail = (words: string, made?: SessionCall): never => {
        made?.refuse(new Error(`${where}: ${at}: ${words}`));
        throw new Error(`${at}: ${words}`);
      };
      switch (line.step) {
        case "open":
          fail("a runtime opens twice.");
          break;
        case "event":
          handlers.onEvent(this.restored(line.event));
          break;
        case "pre-tool-use": {
          const decision = await handlers.preToolUse(this.restored(line.call));
          const problem = difference("the hook's answer", this.restored(line.decision), decision);
          if (problem !== undefined) fail(problem);
          break;
        }
        case "permission": {
          const approved = handlers.permissionRequested(line.toolCallId);
          if (approved !== line.approved) {
            fail(
              `the permission request is ${approved ? "approved" : "rejected"}, not as recorded.`,
            );
          }
          break;
        }
        case "office-tool": {
          const tool =
            spec.officeTools.find(({ name }) => name === line.tool) ??
            fail(`the session has no Office tool ${line.tool}.`);
          officeToolAnswers.set(
            line.toolCallId,
            tool.answer(this.restored(line.args), line.toolCallId).then(
              (answer) => ({ answer }),
              (error: unknown) => ({ error: messageOf(error) }),
            ),
          );
          break;
        }
        case "office-tool-answer": {
          const answered = await officeToolAnswers.get(line.toolCallId);
          if (answered === undefined) fail(`the Office tool call ${line.toolCallId} never ran.`);
          const recorded = this.restored({ answer: line.answer, error: line.error });
          const problem = difference("the Office tool's answer", recorded, answered);
          if (problem !== undefined) fail(problem);
          break;
        }
        case "exited":
          handlers.runtimeExited(line.words);
          return;
        case "closed":
          closing?.answer();
          closing = undefined;
          break;
        default: {
          const made = await calls.next();
          if (made.kind !== line.step) {
            fail(`the session asks ${made.kind} where the recording has ${line.step}.`, made);
          }
          if (line.step === "send") {
            const actual = made.message ?? fail("the session sends no message.", made);
            this.bind(line.message.clientTurnId, actual.clientTurnId);
            const problem = difference(
              "send",
              this.restored(line.message),
              JSON.parse(JSON.stringify(actual)),
            );
            if (problem !== undefined) fail(problem, made);
            made.answer();
          } else if (line.step === "list-skills") {
            made.answer(this.restored(line.skills));
          } else if (line.step === "close") {
            closing = made;
          } else {
            made.answer();
          }
        }
      }
    }
    closing?.answer();
  }

  /** Binds a placeholder to this run's value, the first time it is met. */
  private bind(placeholder: string, value: string): void {
    if (!this.bindings.has(placeholder)) this.bindings.set(placeholder, value);
  }

  /** A recorded value with its placeholders put back as bound. */
  private restored<T>(value: T): T {
    if (value === undefined) return value;
    const json = JSON.stringify(value).replace(PLACEHOLDER, (placeholder) => {
      const bound = this.bindings.get(placeholder);
      return bound === undefined ? placeholder : inJson(bound);
    });
    return JSON.parse(json) as T;
  }
}

/** What the session asked of a stand-in runtime, in order, until the replay takes it. */
class SessionCalls {
  finished = false;
  private readonly waiting: SessionCall[] = [];
  private readonly takers: ((call: SessionCall) => void)[] = [];

  made(kind: SessionCall["kind"], message?: CopilotMessage): Promise<unknown> {
    return new Promise((answer, refuse) => {
      const call: SessionCall = {
        kind,
        ...(message === undefined ? {} : { message }),
        answer,
        refuse,
      };
      const taker = this.takers.shift();
      if (taker === undefined) this.waiting.push(call);
      else taker(call);
    });
  }

  next(): Promise<SessionCall> {
    const call = this.waiting.shift();
    if (call !== undefined) return Promise.resolve(call);
    return new Promise((take) => this.takers.push(take));
  }

  refuseAll(error: Error): void {
    for (const call of this.waiting.splice(0)) call.refuse(error);
  }
}

/** Where the actual value differs from the recorded one, in words, or undefined. */
function difference(path: string, recorded: unknown, actual: unknown): string | undefined {
  if (
    typeof recorded === "object" &&
    recorded !== null &&
    typeof actual === "object" &&
    actual !== null &&
    Array.isArray(recorded) === Array.isArray(actual)
  ) {
    const keys = new Set([...Object.keys(recorded), ...Object.keys(actual)]);
    for (const key of keys) {
      const problem = difference(
        Array.isArray(recorded) ? `${path}[${key}]` : `${path}.${key}`,
        (recorded as Record<string, unknown>)[key],
        (actual as Record<string, unknown>)[key],
      );
      if (problem !== undefined) return problem;
    }
    return undefined;
  }
  if (recorded === actual) return undefined;
  return `${path} is ${shown(actual)} where the recording has ${shown(recorded)}`;
}

function shown(value: unknown): string {
  const text = JSON.stringify(value);
  if (text === undefined) return "nothing";
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
