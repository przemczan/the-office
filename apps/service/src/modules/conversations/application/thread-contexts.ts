import { Injectable } from "@nestjs/common";
import { onceByKey, readEach } from "../../../platform/database/fan-out.js";
import { EngineSessions, type EngineId } from "../../engine/index.js";
import { Duties, EngineCascade, RoleCards } from "../../people/index.js";
import { SkillCommands, type SkillCommand } from "../../skills/index.js";
import type { Brief } from "../domain/brief.js";
import { decideContext, type ContextDecision } from "../domain/context-policy.js";
import { cascadeLocationOf, type SessionCascadeLocation, type Thread } from "../domain/thread.js";
import { AllowChanges } from "./allow-changes.js";
import { Briefs } from "./briefs.js";
import { ContextPolicySettingsService } from "./context-policy-settings.js";
import {
  taskThreadRequest,
  TaskThreadSetups,
  type TaskThreadRequest,
  type TaskThreadSetup,
} from "./task-thread-setups.js";

/** The Brief of a Thread's next session, and the Project the engine cascade is asked in. */
interface ThreadBrief {
  readonly brief: Brief;
  /** A Thread on a Task's Project; undefined for a chat's or an Initiative's, as the runner asks. */
  readonly projectId: string | undefined;
}

/** What a Thread's reading shows besides its record. */
export interface ThreadReading {
  readonly context: ContextDecision;
  /** False when the engine of the Thread's session can't report its context; true with none. */
  readonly contextReported: boolean;
  /** Undefined for a Thread with no Allow changes switch: any but the Caretaker's chat. */
  readonly changesAllowed: boolean | undefined;
  /** The skill commands of the session that takes the next message; none in a Stage Thread. */
  readonly skillCommands: readonly SkillCommand[];
}

/**
 * What the Threads of one reading share, each read once however many Threads ask: a Task's setup
 * by what its Thread asks, the Briefs' common parts, a person's Role card, duties and skills, the
 * engine each person gets at each Task, Initiative and Project, and the settings.
 */
interface SharedReads {
  readonly changesAllowedIn: (thread: Thread) => Promise<boolean | undefined>;
  readonly settings: () => ReturnType<ContextPolicySettingsService["current"]>;
  readonly roleOf: (roleKey: string) => ReturnType<RoleCards["find"]>;
  readonly dutiesOf: (roleKey: string) => ReturnType<Duties["heldBy"]>;
  readonly engineOf: (place: {
    roleKey: string;
    location: SessionCascadeLocation;
  }) => ReturnType<EngineCascade["applying"]>;
  readonly reportsContext: (engineId: EngineId) => Promise<boolean>;
  readonly roleSkillCommands: (roleKey: string) => Promise<readonly SkillCommand[]>;
  readonly taskSetupOf: (request: TaskThreadRequest) => Promise<TaskThreadSetup>;
  readonly taskThreadBrief: (thread: Thread, setup: TaskThreadSetup) => Promise<Brief>;
}

/**
 * What a Thread's next message would do to its session now, for its label (spec §2.5). The engine
 * comes from the cascade in the Thread's Project, as `ThreadRunner` and `StageThreads` ask it.
 * A list of Threads is read together, so what they share (above all one Task's setup) is read once
 * for the list, and the Threads a few at a time (`readEach`).
 */
@Injectable()
export class ThreadContexts {
  constructor(
    private readonly roleCards: RoleCards,
    private readonly engineCascade: EngineCascade,
    private readonly briefs: Briefs,
    private readonly taskThreads: TaskThreadSetups,
    private readonly settings: ContextPolicySettingsService,
    private readonly allowChanges: AllowChanges,
    private readonly engine: EngineSessions,
    private readonly duties: Duties,
    private readonly skillCommands: SkillCommands,
  ) {}

  /**
   * The Thread's context, whether its session reports it, whether changes are allowed in it, and
   * the skill commands its next message may be.
   */
  async read(thread: Thread): Promise<ThreadReading> {
    const [reading] = await this.readEach([thread]);
    return reading!;
  }

  /** `read` for each of the Threads, in their order, reading what they share once. */
  async readEach(threads: readonly Thread[]): Promise<ThreadReading[]> {
    const shared = this.sharedReads(threads);
    return readEach(threads, (thread) => this.readWith(thread, shared));
  }

  /** The Thread's context alone. */
  async of(thread: Thread, now: Date = new Date()): Promise<ContextDecision> {
    const shared = this.sharedReads([thread]);
    return this.contextOf(thread, now, shared);
  }

  private async readWith(thread: Thread, shared: SharedReads): Promise<ThreadReading> {
    const [context, contextReported, changesAllowed] = await Promise.all([
      this.contextOf(thread, new Date(), shared),
      thread.session ? shared.reportsContext(thread.session.engineId) : true,
      shared.changesAllowedIn(thread),
    ]);
    const skillCommands = await this.skillCommandsOf(thread, context, shared);
    return { context, contextReported, changesAllowed, skillCommands };
  }

  private sharedReads(threads: readonly Thread[]): SharedReads {
    // Read as the first Thread asks, so a list with none reads nothing.
    let changesAllowed: Promise<ReadonlyMap<string, boolean | undefined>> | undefined;
    let settings: ReturnType<ContextPolicySettingsService["current"]> | undefined;
    return {
      changesAllowedIn: async (thread) =>
        (await (changesAllowed ??= this.allowChanges.inThreads(threads))).get(thread.id),
      settings: () => (settings ??= this.settings.current()),
      roleOf: onceByKey((roleKey: string) => this.roleCards.find(roleKey), byRoleKey),
      dutiesOf: onceByKey((roleKey: string) => this.duties.heldBy(roleKey), byRoleKey),
      engineOf: onceByKey(({ roleKey, location }) =>
        this.engineCascade.applying(roleKey, location),
      ),
      reportsContext: onceByKey(
        (engineId: EngineId) => this.engine.reportsContext(engineId),
        (engineId) => engineId,
      ),
      roleSkillCommands: onceByKey(
        (roleKey: string) => this.skillCommands.forRole(roleKey),
        byRoleKey,
      ),
      taskSetupOf: onceByKey((request: TaskThreadRequest) => this.taskThreads.of(request)),
      taskThreadBrief: this.briefs.taskThreadBriefing(),
    };
  }

  /**
   * The library skills of the session that takes the next message: the running or resumed
   * session's as it recorded them, or what a new session of the Thread's person would get.
   */
  private async skillCommandsOf(
    thread: Thread,
    context: ContextDecision,
    shared: SharedReads,
  ): Promise<readonly SkillCommand[]> {
    if (thread.stageThread) return [];
    const goesOn = thread.state === "answering" || context.move === "resume";
    return thread.session && goesOn
      ? this.skillCommands.ofSession(thread.session.id)
      : shared.roleSkillCommands(thread.roleKey);
  }

  private async contextOf(
    thread: Thread,
    now: Date,
    shared: SharedReads,
  ): Promise<ContextDecision> {
    const [role, { brief, projectId }, settings, allowed, heldDuties] = await Promise.all([
      shared.roleOf(thread.roleKey),
      this.briefOf(thread, shared),
      shared.settings(),
      shared.changesAllowedIn(thread),
      shared.dutiesOf(thread.roleKey),
    ]);
    // Nobody fills the Role any more, or no engine is listed: its Threads stay readable, and
    // nobody answers.
    const applying =
      role &&
      (await shared.engineOf({
        roleKey: thread.roleKey,
        location: cascadeLocationOf(thread.home, projectId),
      }));
    return decideContext(
      {
        now,
        session: thread.session,
        roleKey: thread.roleKey,
        sessionDefault: role?.card.sessionDefault ?? "context-policy",
        engineId: applying?.engineId,
        forced: applying?.standIns.from === "none",
        override: thread.override,
        briefTokens: brief.tokens,
        changesAllowed: allowed,
        heldDuties,
      },
      settings,
    );
  }

  /** A Thread on a Task is set up once, for both its Brief and its Project. */
  private async briefOf(thread: Thread, shared: SharedReads): Promise<ThreadBrief> {
    const { home } = thread;
    if (home.kind !== "task") {
      return { brief: await this.briefs.forThread(thread), projectId: undefined };
    }
    const setup = await shared.taskSetupOf(taskThreadRequest(thread, home.taskId));
    return { brief: await shared.taskThreadBrief(thread, setup), projectId: setup.projectId };
  }
}

function byRoleKey(roleKey: string): string {
  return roleKey;
}
