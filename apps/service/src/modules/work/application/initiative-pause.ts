import type { Author } from "../domain/author.js";
import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import type { Initiative } from "../domain/initiative.js";
import { pauseInitiative, resumeInitiative } from "../domain/initiative-pause.js";
import { TaskResumed } from "../domain/task-events.js";
import { stopsEveryWalk } from "../domain/fire-alarm.js";
import { FireAlarmRepository } from "../ports/fire-alarm-repository.js";
import { InitiativeRepository } from "../ports/initiative-repository.js";
import { TaskService } from "./task-service.js";

/** What Pause or Resume the Initiative did: the Initiative, and the Tasks it paused or resumed. */
export interface InitiativePauseOutcome {
  readonly initiative: Initiative;
  readonly taskIds: readonly string[];
}

/**
 * Pause the Initiative and Resume the Initiative (spec §2.1). Each holds the Initiative and then
 * its Tasks, saving the mark and the Tasks' changes in one transaction, and publishes after the
 * save: Pipelines holds and walks the Stages on the Tasks' TaskPaused and TaskResumed, and the
 * queue releases on InitiativeResumed.
 */
@Injectable()
export class InitiativePause {
  constructor(
    private readonly initiatives: InitiativeRepository,
    private readonly fireAlarm: FireAlarmRepository,
    private readonly tasks: TaskService,
    private readonly events: EventBus,
  ) {}

  /** Refused with the reason (InitiativeRefused) unless the Initiative is active and not paused. */
  async pause(id: string, by: Author): Promise<InitiativePauseOutcome> {
    const { initiative, event, taskChanges } = await this.initiatives.updateWithTasks(
      id,
      (held, tasks) => pauseInitiative(held, tasks, new Date(), by),
    );
    if (event) await this.events.publish(event);
    for (const { event: paused } of taskChanges) await this.events.publish(paused);
    return { initiative, taskIds: taskChanges.map(({ task }) => task.id) };
  }

  /**
   * Refused with the reason unless the Initiative is paused. While the fire alarm is on ASAP, the Tasks
   * its Pause held are held by the alarm instead, which the all clear resumes.
   */
  async resume(id: string, by: Author): Promise<InitiativePauseOutcome> {
    const alarmHoldsResume = stopsEveryWalk(await this.fireAlarm.read());
    const { initiative, event, taskChanges } = await this.initiatives.updateWithTasks(
      id,
      (held, tasks) => resumeInitiative(held, tasks, { alarmHoldsResume }, by),
    );
    // Read again after the save, as a single Resume does: an alarm sounded ASAP meanwhile may have
    // passed the resumed Tasks by as Paused, so the alarm holds them instead.
    const soundedSince = !alarmHoldsResume && stopsEveryWalk(await this.fireAlarm.read());
    if (event) await this.events.publish(event);
    for (const { task, event: taskEvent } of taskChanges) {
      if (soundedSince && taskEvent instanceof TaskResumed) {
        await this.tasks.holdForFireAlarm(task.id);
      } else {
        await this.events.publish(taskEvent);
      }
    }
    return { initiative, taskIds: taskChanges.map(({ task }) => task.id) };
  }
}
