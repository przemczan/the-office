import { Injectable } from "@nestjs/common";
import { EngineCascade, RoleCards } from "../../people/index.js";
import type { Brief } from "../domain/brief.js";
import { decideContext, type ContextDecision } from "../domain/context-policy.js";
import type { Thread } from "../domain/thread.js";
import { AllowChanges } from "./allow-changes.js";
import { Briefs } from "./briefs.js";
import { ContextPolicySettingsService } from "./context-policy-settings.js";
import { TaskThreadSetups } from "./task-thread-setups.js";

/** The Brief of a Thread's next session, and the Project the engine cascade is asked in. */
interface ThreadBrief {
  readonly brief: Brief;
  /** A Thread on a Task's Project; undefined for a chat's or an Initiative's, as the runner asks. */
  readonly projectId: string | undefined;
}

/** What a Thread's reading shows besides its record. */
export interface ThreadReading {
  readonly context: ContextDecision;
  /** Undefined for a Thread with no Allow changes switch: any but the Caretaker's chat. */
  readonly changesAllowed: boolean | undefined;
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
  ) {}

  /** The Thread's context, and whether changes are allowed in it. */
  async read(thread: Thread): Promise<ThreadReading> {
    const changesAllowed = await this.allowChanges.inThread(thread);
    return { context: await this.of(thread, new Date(), changesAllowed), changesAllowed };
  }

  async of(
    thread: Thread,
    now: Date = new Date(),
    changesAllowed?: boolean,
  ): Promise<ContextDecision> {
    const [role, { brief, projectId }, settings, allowed] = await Promise.all([
      this.roleCards.find(thread.roleKey),
      this.briefOf(thread),
      this.settings.current(),
      changesAllowed ?? this.allowChanges.inThread(thread),
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
    const setup = await this.taskThreads.of({
      threadId: thread.id,
      taskId: home.taskId,
      roleKey: thread.roleKey,
    });
    return { brief: await this.briefs.forTaskThread(thread, setup), projectId: setup.projectId };
  }
}
