import { Injectable } from "@nestjs/common";
import { EngineSessions } from "../../engine/index.js";
import { Duties, EngineCascade, RoleCards } from "../../people/index.js";
import { SkillCommands, type SkillCommand } from "../../skills/index.js";
import type { Brief } from "../domain/brief.js";
import { decideContext, type ContextDecision } from "../domain/context-policy.js";
import type { Thread } from "../domain/thread.js";
import { AllowChanges } from "./allow-changes.js";
import { Briefs } from "./briefs.js";
import { ContextPolicySettingsService } from "./context-policy-settings.js";
import { taskThreadRequest, TaskThreadSetups } from "./task-thread-setups.js";

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
 * What a Thread's next message would do to its session now, for its label (spec §2.5). The engine
 * comes from the cascade in the Thread's Project, as `ThreadRunner` and `StageThreads` ask it.
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
    const changesAllowed = await this.allowChanges.inThread(thread);
    const [context, contextReported] = await Promise.all([
      this.of(thread, new Date(), changesAllowed),
      thread.session ? this.engine.reportsContext(thread.session.engineId) : true,
    ]);
    const skillCommands = await this.skillCommandsOf(thread, context);
    return { context, contextReported, changesAllowed, skillCommands };
  }

  /**
   * The library skills of the session that takes the next message: the running or resumed
   * session's as it recorded them, or what a new session of the Thread's person would get.
   */
  private async skillCommandsOf(
    thread: Thread,
    context: ContextDecision,
  ): Promise<readonly SkillCommand[]> {
    if (thread.stageThread) return [];
    const goesOn = thread.state === "answering" || context.move === "resume";
    return thread.session && goesOn
      ? this.skillCommands.ofSession(thread.session.id)
      : this.skillCommands.forRole(thread.roleKey);
  }

  async of(
    thread: Thread,
    now: Date = new Date(),
    changesAllowed?: boolean,
  ): Promise<ContextDecision> {
    const [role, { brief, projectId }, settings, allowed, heldDuties] = await Promise.all([
      this.roleCards.find(thread.roleKey),
      this.briefOf(thread),
      this.settings.current(),
      changesAllowed ?? this.allowChanges.inThread(thread),
      this.duties.heldBy(thread.roleKey),
    ]);
    // Nobody fills the Role any more, or no engine is listed: its Threads stay readable, and
    // nobody answers.
    const applying = role && (await this.engineCascade.applying(thread.roleKey, projectId));
    return decideContext(
      {
        now,
        session: thread.session,
        roleKey: thread.roleKey,
        sessionDefault: role?.card.sessionDefault ?? "context-policy",
        engineId: applying?.engineId,
        override: thread.override,
        briefTokens: brief.tokens,
        changesAllowed: allowed,
        heldDuties,
      },
      settings,
    );
  }

  /** A Thread on a Task is set up once, for both its Brief and its Project. */
  private async briefOf(thread: Thread): Promise<ThreadBrief> {
    const { home } = thread;
    if (home.kind !== "task") {
      return { brief: await this.briefs.forThread(thread), projectId: undefined };
    }
    const setup = await this.taskThreads.of(taskThreadRequest(thread, home.taskId));
    return { brief: await this.briefs.forTaskThread(thread, setup), projectId: setup.projectId };
  }
}
