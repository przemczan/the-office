import type { Author } from "../domain/author.js";
import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { PromptTemplates } from "../../prompt-templates/index.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import { latestPlanningThread, type Initiative } from "../domain/initiative.js";
import type { InitiativePlanningStarted } from "../domain/initiative-events.js";
import {
  INITIATIVE_PLANNING_THREAD_TITLE,
  initiativePlanningOpening,
  startInitiativePlanning,
  stillPlanningWords,
  type InitiativePlanningStart,
} from "../domain/initiative-planning.js";
import { InitiativeRefused } from "../domain/initiative-refused.js";
import { NOBODY_PLANS, PLANS } from "../domain/duties.js";
import { InitiativeRepository, type InitiativeUpdate } from "../ports/initiative-repository.js";
import { InitiativeThreads } from "../ports/initiative-threads.js";
import { KnownPeople } from "../ports/known-people.js";
import { ThreadTurns } from "../ports/thread-turns.js";
import { WorkSettings } from "../ports/work-settings.js";
import { INITIATIVE_PLANNING_OPENING } from "../domain/work-prompt-templates.js";

/**
 * Plan the Initiative and Plan with… (spec §2.1): one planning Thread with whoever holds Plans on an
 * active Initiative, which plans its Backlog Tasks in their dependency order. Plan the Initiative
 * starts them at once, in auto mode or not as the user chose, the choice becoming Make a plan's
 * remembered default too; Plan with… has them wait for the user's instructions, with auto mode off.
 */
@Injectable()
export class InitiativePlanning {
  constructor(
    private readonly initiatives: InitiativeRepository,
    private readonly threads: InitiativeThreads,
    private readonly people: KnownPeople,
    private readonly turns: ThreadTurns,
    private readonly settings: WorkSettings,
    private readonly events: EventBus,
    private readonly promptTemplates: PromptTemplates,
  ) {}

  /**
   * Opens a new planning Thread on the Initiative, where whoever holds Plans starts at once.
   * Refused with the reasons while nobody holds Plans, while its latest planning Thread has a turn
   * running, unless the Initiative is active with a Task in Backlog, and while one of its Tasks is
   * still being planned in an earlier planning Thread.
   */
  async plan(initiativeId: string, autoMode: boolean, by: Author): Promise<Initiative> {
    const planner = await this.plannerOrRefuse(initiativeId);
    const threadId = randomUUID();
    const { initiative, event } = await this.startPlanning(initiativeId, {
      threadId,
      autoMode,
      withUser: false,
      by,
      at: new Date(),
    });
    await this.settings.changeAutoMode(autoMode);
    const prompts = await this.promptTemplates.textsOf([INITIATIVE_PLANNING_OPENING]);
    await this.threads.startOnInitiative({
      threadId,
      initiativeId,
      roleKey: planner,
      title: INITIATIVE_PLANNING_THREAD_TITLE,
      opening: initiativePlanningOpening(prompts),
    });
    // Published once the Thread is there, for the page's link to open it.
    if (event) await this.events.publish(event);
    return initiative;
  }

  /**
   * Plan with…: opens a new planning Thread on the Initiative where whoever holds Plans waits for
   * the user's first message on how to plan it, with auto mode off and the remembered default left
   * as it is. Refused with the same reasons as `plan`.
   */
  async planWith(initiativeId: string, by: Author): Promise<Initiative> {
    const planner = await this.plannerOrRefuse(initiativeId);
    const threadId = randomUUID();
    const { initiative, event } = await this.startPlanning(initiativeId, {
      threadId,
      autoMode: false,
      withUser: true,
      by,
      at: new Date(),
    });
    await this.threads.openOnInitiative({
      threadId,
      initiativeId,
      roleKey: planner,
      title: INITIATIVE_PLANNING_THREAD_TITLE,
    });
    if (event) await this.events.publish(event);
    return initiative;
  }

  /**
   * Whoever holds Plans, by their Role's key. Refused while nobody does, and while the
   * Initiative's latest planning Thread has a turn running: the user writes there instead. Read
   * outside the Initiative's hold, as the turn is Conversations' and never in its row.
   */
  private async plannerOrRefuse(initiativeId: string): Promise<string> {
    const planner = await this.people.holderOf(PLANS);
    if (planner === undefined) throw new InitiativeRefused([NOBODY_PLANS]);
    const initiative = await this.initiatives.find(initiativeId);
    const latest = initiative && latestPlanningThread(initiative);
    if (latest && (await this.turns.isTurnRunning(latest.threadId))) {
      const name = (await this.people.find(planner))?.card.name ?? planner;
      throw new InitiativeRefused([stillPlanningWords(name)]);
    }
    return planner;
  }

  /** The Thread's id is kept first, so its first session's Brief and start_planning find it. */
  private startPlanning(
    initiativeId: string,
    start: InitiativePlanningStart,
  ): Promise<InitiativeUpdate<InitiativePlanningStarted>> {
    return this.initiatives.update(initiativeId, (latest, tasks) =>
      startInitiativePlanning(latest, tasks, start),
    );
  }
}
