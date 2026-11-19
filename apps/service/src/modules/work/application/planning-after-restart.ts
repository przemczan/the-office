import { Injectable, Logger } from "@nestjs/common";
import { PromptTemplates } from "../../prompt-templates/index.js";
import { PLANS } from "../domain/duties.js";
import { initiativePlanningAfterRestartOpening } from "../domain/initiative-planning.js";
import { isInitiativePaused } from "../domain/initiative-pause.js";
import { planningAfterRestartOpening } from "../domain/planning.js";
import type { Task } from "../domain/task.js";
import {
  INITIATIVE_PLANNING_AFTER_RESTART_OPENING,
  PLANNING_AFTER_RESTART_OPENING,
} from "../domain/work-prompt-templates.js";
import { InitiativeRepository } from "../ports/initiative-repository.js";
import { InitiativeThreads } from "../ports/initiative-threads.js";
import { KnownPeople } from "../ports/known-people.js";
import { TaskRepository } from "../ports/task-repository.js";
import { TaskThreads } from "../ports/task-threads.js";
import { FireAlarmService } from "./fire-alarm-service.js";

/** A planning Thread to wake, and what to wake the planner with. */
interface Waking {
  readonly threadId: string;
  readonly opening: string;
  readonly threads: TaskThreads | InitiativeThreads;
}

/**
 * Planning goes on after a restart (spec §2.4): a planning Thread works on its own, so one the
 * restart cut short, mid-turn or with background Sub-agents running, has its planner woken in it
 * again while it still has a Task in Planning. Run as the service starts, after the fire alarm's
 * state is settled. Nothing is woken while the alarm sounds, nor for an Initiative the user paused:
 * the user writes in the Thread to go on. Shaping, chat, Consultation and Stage Threads are left as
 * they are.
 */
@Injectable()
export class PlanningAfterRestart {
  private readonly logger = new Logger(PlanningAfterRestart.name);

  constructor(
    private readonly tasks: TaskRepository,
    private readonly initiatives: InitiativeRepository,
    private readonly taskThreads: TaskThreads,
    private readonly initiativeThreads: InitiativeThreads,
    private readonly people: KnownPeople,
    private readonly fireAlarm: FireAlarmService,
    private readonly promptTemplates: PromptTemplates,
  ) {}

  /** Wakes the planner in each of the cut-short Threads that is a planning Thread to go on with. */
  async wake(cutShortThreadIds: readonly string[]): Promise<void> {
    if (cutShortThreadIds.length === 0 || (await this.fireAlarm.read()).on) return;
    const inPlanning = (await this.tasks.list()).filter(({ state }) => state === "planning");
    for (const threadId of new Set(cutShortThreadIds)) {
      const waking = await this.wakingIn(threadId, inPlanning);
      if (waking) await this.wakeIn(waking);
    }
  }

  private async wakingIn(
    threadId: string,
    inPlanning: readonly Task[],
  ): Promise<Waking | undefined> {
    const plannedThere = inPlanning.find(
      ({ initiativePlanningThreadId }) => initiativePlanningThreadId === threadId,
    );
    if (plannedThere) {
      if (await this.initiativePaused(plannedThere)) return undefined;
      const prompts = await this.promptTemplates.textsOf([
        INITIATIVE_PLANNING_AFTER_RESTART_OPENING,
      ]);
      return {
        threadId,
        opening: initiativePlanningAfterRestartOpening(prompts),
        threads: this.initiativeThreads,
      };
    }
    const persons = await this.taskThreads.personsThreadOnTask(threadId);
    if (!persons || persons.roleKey !== (await this.people.holderOf(PLANS))) return undefined;
    const task = inPlanning.find(({ id }) => id === persons.taskId);
    // Planned in its Initiative's Thread, the Task's own is no planning Thread now.
    if (!task || task.initiativePlanningThreadId !== undefined) return undefined;
    if (await this.initiativePaused(task)) return undefined;
    const prompts = await this.promptTemplates.textsOf([PLANNING_AFTER_RESTART_OPENING]);
    return { threadId, opening: planningAfterRestartOpening(prompts), threads: this.taskThreads };
  }

  private async initiativePaused({ initiativeId }: Task): Promise<boolean> {
    if (initiativeId === undefined) return false;
    const initiative = await this.initiatives.find(initiativeId);
    return initiative !== undefined && isInitiativePaused(initiative);
  }

  /** One Thread failing to wake leaves the others, and the start, to go on. */
  private async wakeIn({ threadId, opening, threads }: Waking): Promise<void> {
    try {
      await threads.askAgain(threadId, opening);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `The planner wasn't woken in Thread ${threadId} after the restart: ${reason}`,
      );
    }
  }
}
