import { Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { isAbsolute, relative, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { AsyncChannel } from "../../../../platform/streams/async-channel.js";
import type { ToolDecision } from "../../domain/office-rules.js";
import { listingProblems } from "../../domain/skill-listing.js";
import type { UsageWindows } from "../../domain/usage-windows.js";
import { CapabilityMissing, SessionSkillsDiffer } from "../../ports/agent-engine.js";
import type {
  ContextUsage,
  EngineSession,
  MessagePriority,
  UserMessage,
} from "../../ports/engine-session.js";
import type { SessionEvent } from "../../ports/session-events.js";
import type { JsonSchema, ToolHold } from "../../ports/session-options.js";
import type { ToolDecider } from "../office-rules/office-tool-call.js";
import type { ListedSkill } from "../skills/listed-skills.js";
import { skillCommandText } from "../skills/skill-loading.js";
import { CopilotTurnEvents } from "./copilot-events.js";
import type {
  CopilotEvent,
  CopilotListedSkill,
  CopilotMessage,
  CopilotRuntimeSession,
  CopilotSessionSpec,
  CopilotToolCall,
  CopilotToolDecision,
  OpenCopilotSession,
} from "./copilot-runtime.js";
import {
  copilotDecision,
  copilotToolCall,
  type CopilotToolJudgement,
  type CopilotToolSession,
} from "./copilot-tool-actions.js";

/** What a session must list at its start (spec §5.6), and where its library skills are. */
export interface CopilotSessionSkills {
  /** The session's own skills folder's `skills/`, each skill in a folder of its name. */
  readonly libraryFolder: string;
  readonly expected: readonly string[];
  readonly userOnly: readonly string[];
  /** As the Office reads them, for a skill command the runtime doesn't list. */
  readonly listed: readonly ListedSkill[];
}

/** What a session runs on and is held to. */
export interface CopilotCliSessionParts {
  readonly open: OpenCopilotSession;
  readonly spec: CopilotSessionSpec;
  /** The session's Office tools and MCP servers, which tell a tool's name apart. */
  readonly tools: CopilotToolSession;
  /** Asked first for every call: its words refuse it. */
  readonly toolHold: ToolHold | undefined;
  /** The Office rules' decision on one Copilot CLI tool call, the approval hold with them. */
  readonly decide: ToolDecider;
  /** Replaces every Server value in words the runtime gave, as an MCP server's failure may hold one. */
  readonly redact: (text: string) => string;
  readonly outputSchema: JsonSchema | undefined;
  /** Undefined for a session with no skill at all. */
  readonly skills: CopilotSessionSkills | undefined;
  /** Removes what the session made beside its runtime: its temporary folder. */
  readonly close: () => Promise<void>;
}

const logger = new Logger("CopilotCliSession");

/** The plugin the Skills module names a session's folder: Claude Code lists its skills under it. */
const SESSION_PLUGIN = "office";

/** How long Stop waits for the runtime to end the turn before the session fails. */
const INTERRUPT_GRACE_MS = 30_000;

/**
 * A session on its own Copilot CLI runtime (spec §5.4, the Copilot CLI engine). While no turn
 * runs, a message is sent `enqueue`, which starts one; while one runs, `next` is sent `immediate`,
 * which lands before the turn's next tool call, and `later` is held until the turn has ended, then
 * sent `enqueue` to start the next: one sent `enqueue` while a turn runs is taken before the
 * turn's one `session.idle`, so in the same turn (the contract's `later`, live). Whether a turn
 * runs is read from the runtime's events: from a send or a `user.message` to the `session.idle`
 * that ends it. Every tool call is judged in the runtime's
 * pre-tool-use hook by the Office rules; a refusal is reported here, the denied result by the
 * runtime's events.
 */
export class CopilotCliSession implements EngineSession {
  private readonly reported = new AsyncChannel<SessionEvent>();
  private readonly turnEvents: CopilotTurnEvents;
  private runtime: CopilotRuntimeSession | undefined;
  private turnRunning = false;
  /** The ids of the messages sent and not yet taken by a turn. */
  private readonly sentMessages = new Set<string>();
  /** The `later` messages sent while a turn runs, held for the turn after it. */
  private readonly heldMessages: UserMessage[] = [];
  /** The calls the hook allowed and that haven't ended: the permission requests approved. */
  private readonly allowedCalls = new Set<string>();
  /** Messages are sent one after another, in the order they came. */
  private sending: Promise<void> = Promise.resolve();
  private readonly turnEndWaiters: (() => void)[] = [];
  /** The runtime's name of each skill it lists, by the name the session lists it by. */
  private readonly runtimeSkillNames = new Map<string, string>();
  private ending: Promise<void> | undefined;
  private failed = false;

  constructor(
    readonly id: string,
    private readonly parts: CopilotCliSessionParts,
  ) {
    this.turnEvents = new CopilotTurnEvents({
      session: parts.tools,
      hasOutputSchema: parts.outputSchema !== undefined,
      messageIdOf: ({ clientTurnId }) => this.takenMessage(clientTurnId),
      redact: parts.redact,
    });
  }

  get events(): AsyncIterable<SessionEvent> {
    return this.reported;
  }

  /**
   * Starts the runtime on the session, then checks it lists exactly the session's skills: one that
   * doesn't is ended again and refused with `SessionSkillsDiffer`, before any message.
   */
  async open(): Promise<void> {
    const runtime = await this.parts.open(this.parts.spec, {
      onEvent: (event) => this.received(event),
      preToolUse: (call) => this.judged(call),
      permissionRequested: (callId) => callId !== undefined && this.allowedCalls.has(callId),
      runtimeExited: (words) => this.fail(new Error(words)),
    });
    if (this.ending !== undefined || this.failed) {
      await runtime.close();
      throw new Error("The session ended as its Copilot CLI runtime started.");
    }
    this.runtime = runtime;
    const problems = this.skillProblems(await runtime.listSkills());
    if (problems.length > 0) {
      await this.end();
      throw new SessionSkillsDiffer(this.id, problems);
    }
  }

  send(message: UserMessage, priority: MessagePriority): void {
    if (this.ending !== undefined || this.failed) return;
    if (this.turnRunning && priority === "later") {
      this.heldMessages.push(message);
      return;
    }
    this.sendNow(message, this.turnRunning ? "immediate" : "enqueue");
  }

  /**
   * Sends the messages held while the turn ran, all `enqueue`: the first starts the next turn, the
   * others join it, so that turn takes them all.
   */
  private sendHeld(): void {
    if (this.ending !== undefined || this.failed) return;
    for (const message of this.heldMessages.splice(0)) this.sendNow(message, "enqueue");
  }

  private sendNow(message: UserMessage, mode: CopilotMessage["mode"]): void {
    this.turnRunning = true;
    this.sentMessages.add(message.id);
    this.sending = this.sending
      .then(() => this.deliver(message, mode))
      .catch((error: unknown) => this.fail(error));
  }

  private async deliver(message: UserMessage, mode: CopilotMessage["mode"]): Promise<void> {
    const sent = await this.copilotMessage(message, mode);
    await this.runtime?.send(sent);
  }

  /**
   * Stops the running turn, its running command with it (`abort()`), and returns once the turn has
   * ended `interrupted`; a runtime that doesn't end it in time fails the session.
   */
  async interrupt(): Promise<void> {
    const runtime = this.runtime;
    if (!this.turnRunning || runtime === undefined) return;
    const ended = new Promise<boolean>((resolve) => this.turnEndWaiters.push(() => resolve(true)));
    await runtime.abort();
    const inTime = await Promise.race([ended, delay(INTERRUPT_GRACE_MS, false, { ref: false })]);
    if (!inTime) {
      this.fail(
        new Error(
          `The Copilot CLI runtime didn't end the turn within ${INTERRUPT_GRACE_MS / 1000} seconds of Stop.`,
        ),
      );
    }
  }

  /** The engine has no usage windows, by decision (spec §5.4). */
  readUsageWindows(): Promise<UsageWindows | undefined> {
    return Promise.reject(new CapabilityMissing("usageWindows"));
  }

  /** As `session.usage_info` last gave it; none before the session's first model call. */
  async readContextUsage(): Promise<ContextUsage> {
    const usage = this.turnEvents.contextUsage();
    return usage === undefined
      ? { tokens: 0, window: 0 }
      : { tokens: usage.tokens, window: usage.limit };
  }

  /** Ends the runtime with every process it started, then the session's own; once events end. */
  end(): Promise<void> {
    this.ending ??= this.ended();
    return this.ending;
  }

  private async ended(): Promise<void> {
    this.settleTurnEndWaiters();
    const runtime = this.runtime;
    this.runtime = undefined;
    await runtime?.close().catch((error: unknown) => {
      logger.warn(`Closing the Copilot CLI runtime failed: ${messageOf(error)}`);
    });
    await this.sending;
    await this.parts.close();
    if (!this.failed) this.reported.close();
  }

  private fail(error: unknown): void {
    if (this.failed || this.ending !== undefined) return;
    this.failed = true;
    this.reported.fail(error);
    this.settleTurnEndWaiters();
    const runtime = this.runtime;
    this.runtime = undefined;
    // oxlint-disable-next-line office/caught-voided-calls -- abandoning never rejects
    void this.abandon(runtime);
  }

  /** Closes what a failed session ran on; nobody is left to tell of a failure here. */
  private async abandon(runtime: CopilotRuntimeSession | undefined): Promise<void> {
    try {
      await runtime?.close();
      await this.parts.close();
    } catch {
      // The session has failed already.
    }
  }

  private received(event: CopilotEvent): void {
    if (event.agentId === undefined) {
      if (event.type === "user.message" || event.type === "assistant.turn_start") {
        this.turnRunning = true;
      }
      if (event.type === "tool.execution_complete") this.allowedCalls.delete(event.data.toolCallId);
    }
    for (const mapped of this.turnEvents.map(event)) {
      this.report(mapped);
      if (mapped.kind === "turn-ended") {
        this.turnRunning = false;
        this.settleTurnEndWaiters();
        this.sendHeld();
      }
    }
  }

  private takenMessage(clientTurnId: string | undefined): string | undefined {
    if (clientTurnId === undefined || !this.sentMessages.has(clientTurnId)) return undefined;
    this.sentMessages.delete(clientTurnId);
    return clientTurnId;
  }

  /**
   * The pre-tool-use hook's answer: refused in the hold's words while The Office holds every call,
   * else by the Office rules on what the call is to them; a tool they can't judge is refused, and
   * so is any call the judging fails on. A refusal is reported as the Office rules'.
   */
  private async judged(call: CopilotToolCall): Promise<CopilotToolDecision> {
    let judgement: CopilotToolJudgement | undefined;
    let decision: ToolDecision;
    try {
      judgement = copilotToolCall(call.toolName, call.toolArgs, this.parts.tools);
      const held = await this.parts.toolHold?.();
      decision =
        held === undefined
          ? await copilotDecision(judgement, this.parts.decide)
          : { allowed: false, reason: held };
    } catch (error) {
      decision = {
        allowed: false,
        reason: `Refused by The Office: it could not judge this call (${messageOf(error)}).`,
      };
    }
    if (decision.allowed) {
      if (call.toolCallId !== undefined) this.allowedCalls.add(call.toolCallId);
      return { allowed: true };
    }
    this.report({
      kind: "tool-refused",
      callId: call.toolCallId ?? `refused-${randomUUID()}`,
      tool: judgement?.kind === "judged" ? judgement.display.tool : call.toolName,
      reason: decision.reason,
      refusedBy: "office-rules",
    });
    return { allowed: false, reason: decision.reason };
  }

  /**
   * A message as the runtime takes it: its images as blobs; a skill command as the runtime runs
   * one, `/<skill> <input>`, or as its skill's text for one the runtime doesn't list. The output
   * schema goes with every `enqueue`, as a schema with `immediate` is refused and immediate
   * steering keeps the running turn's.
   */
  private async copilotMessage(
    message: UserMessage,
    mode: CopilotMessage["mode"],
  ): Promise<CopilotMessage> {
    return {
      prompt: await this.prompt(message),
      attachments: (message.images ?? []).map((image) => ({
        type: "blob",
        data: Buffer.from(image.content).toString("base64"),
        mimeType: image.mediaType,
        displayName: image.name,
      })),
      mode,
      responseSchema: mode === "immediate" ? undefined : this.parts.outputSchema,
      clientTurnId: message.id,
    };
  }

  private async prompt({ text, skillCommand }: UserMessage): Promise<string> {
    if (skillCommand === undefined) return text;
    const runtimeName = this.runtimeSkillNames.get(skillCommand.skill);
    if (runtimeName !== undefined) return `/${runtimeName} ${skillCommand.input}`.trim();
    return (await skillCommandText(this.parts.skills?.listed ?? [], skillCommand)) ?? text;
  }

  /**
   * Why the runtime's listing isn't the session's skills: each skill it loaded, by the name the
   * session lists it as, against what the session must list, but for those only the user runs.
   */
  private skillProblems(listing: readonly CopilotListedSkill[]): string[] {
    const skills = this.parts.skills;
    const userOnly = new Set(skills?.userOnly ?? []);
    const listed: string[] = [];
    for (const skill of listing) {
      if (!skill.enabled) continue;
      const name = sessionSkillName(skill, skills?.libraryFolder);
      this.runtimeSkillNames.set(name, skill.name);
      if (!userOnly.has(name)) listed.push(name);
    }
    return listingProblems(skills?.expected ?? [], listed);
  }

  private settleTurnEndWaiters(): void {
    for (const settle of this.turnEndWaiters.splice(0)) settle();
  }

  private report(event: SessionEvent): void {
    if (this.reported.isOpen) this.reported.push(event);
  }
}

/**
 * The name the session lists a skill by: a library skill, in a folder of the session's own skills
 * folder, as `office:<folder>`, as Claude Code lists it from the session's plugin; any other, such
 * as a Project's, by the runtime's name, its frontmatter's.
 */
export function sessionSkillName(
  skill: CopilotListedSkill,
  libraryFolder: string | undefined,
): string {
  if (skill.path === undefined || libraryFolder === undefined) return skill.name;
  const inside = relative(libraryFolder, skill.path);
  if (inside === "" || inside.startsWith("..") || isAbsolute(inside)) return skill.name;
  const [folder] = inside.split(sep);
  return folder === undefined || folder === "" ? skill.name : `${SESSION_PLUGIN}:${folder}`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
