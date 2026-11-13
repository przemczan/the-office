import type { Author } from "../domain/author.js";
import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import type { Initiative } from "../domain/initiative.js";
import {
  INITIATIVE_PLANNING_OPENING,
  INITIATIVE_PLANNING_THREAD_TITLE,
  startInitiativePlanning,
} from "../domain/initiative-planning.js";
import { InitiativeRefused } from "../domain/initiative-refused.js";
import { PLANNER } from "../domain/planning.js";
import { InitiativeRepository } from "../ports/initiative-repository.js";
import { InitiativeThreads } from "../ports/initiative-threads.js";
import { KnownPeople } from "../ports/known-people.js";
import { WorkSettings } from "../ports/work-settings.js";

/**
 * Plan the Initiative (spec §2.1): one planning Thread with the Planner on an active Initiative,
 * which plans its Backlog Tasks in their dependency order, in auto mode or not as the user chose,
 * the choice becoming Make a plan's remembered default too.
 */
@Injectable()
export class InitiativePlanning {
  constructor(
    private readonly initiatives: InitiativeRepository,
    private readonly threads: InitiativeThreads,
    private readonly people: KnownPeople,
    private readonly settings: WorkSettings,
    private readonly events: EventBus,
  ) {}

  /**
   * Opens a new planning Thread on the Initiative, where the Planner starts at once. Refused with
   * the reasons while nobody is the Planner, unless the Initiative is active with a Task in
   * Backlog, and while one of its Tasks is still being planned in an earlier planning Thread.
   */
  async plan(initiativeId: string, autoMode: boolean, by: Author): Promise<Initiative> {
    if (!(await this.people.find(PLANNER))) {
      throw new InitiativeRefused([
        "Hire a Planner on People first: planning is a conversation with them.",
      ]);
    }
    // The Thread's id is kept first, so its first session's Brief and start_planning find it.
    const threadId = randomUUID();
    const { initiative, event } = await this.initiatives.update(initiativeId, (latest, tasks) =>
      startInitiativePlanning(latest, tasks, { threadId, autoMode, by }),
    );
    await this.settings.changeAutoMode(autoMode);
    await this.threads.startOnInitiative({
      threadId,
      initiativeId,
      roleKey: PLANNER,
      title: INITIATIVE_PLANNING_THREAD_TITLE,
      opening: INITIATIVE_PLANNING_OPENING,
    });
    // Published once the Thread is there, for the page's link to open it.
    if (event) await this.events.publish(event);
    return initiative;
  }
}
