import type { Author } from "../domain/author.js";
import { Injectable } from "@nestjs/common";
import type { DomainEvent } from "../../../platform/events/domain-event.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import { Schedule } from "../../../platform/schedule/schedule.js";
import { hardStopAt, type FireAlarm } from "../domain/fire-alarm.js";
import { AlarmSounded, AllClearGiven } from "../domain/fire-alarm-events.js";
import {
  giveTaskAllClear,
  pauseTaskForAlarm,
  type AllClearChoice,
  type TaskChange,
} from "../domain/task-changes.js";
import { TaskHeldAtAllClear, TaskResumed, TaskStateChanged } from "../domain/task-events.js";
import { FireAlarmRepository } from "../ports/fire-alarm-repository.js";
import { TaskRepository } from "../ports/task-repository.js";

/**
 * The fire alarm (spec §2.8): sounding it pauses every Task In progress or Waiting on you as paused
 * by the alarm, which Pipelines holds at the next safe point; Start holds while it is on, and the
 * all clear resumes, holds or drops each Task it paused.
 */
@Injectable()
export class FireAlarmService {
  constructor(
    private readonly alarm: FireAlarmRepository,
    private readonly tasks: TaskRepository,
    private readonly schedule: Schedule,
    private readonly events: EventBus,
  ) {}

  read(): Promise<FireAlarm> {
    return this.alarm.read();
  }

  /**
   * Sounds the alarm; sounded again, it leaves it as it is. Either way it pauses the started Tasks
   * still running. AlarmSounded comes after, so the hard stop it sets reaches every run held.
   */
  async sound(): Promise<FireAlarm> {
    const since = this.schedule.now();
    const turnedOn = await this.alarm.sound(since);
    // Once the alarm is on, so a Start holding Starts meanwhile either saw it or is paused here.
    await this.pauseStartedTasks();
    if (turnedOn) await this.events.publish(new AlarmSounded(since, hardStopAt(since)));
    return this.alarm.read();
  }

  /**
   * The all clear (spec §2.8): each Task the alarm paused resumes, unless the user chose to hold or
   * drop it, then the alarm turns off. Nothing while it is off already. The Tasks change first,
   * their events waiting until the alarm is off: should the service stop between, the boot's
   * `finishSounding` pauses them again for an alarm still on, and nothing is left paused by an
   * alarm that is off.
   */
  async giveAllClear(choices: AllClearChoices, by: Author): Promise<FireAlarm> {
    if (!(await this.alarm.read()).on) return this.alarm.read();
    const changes = await this.tasks.updateEveryStarted((task) =>
      giveTaskAllClear(task, choiceFor(task.id, choices), by),
    );
    if (await this.alarm.allClear()) {
      for (const { event } of changes) await this.events.publish(event);
      await this.events.publish(allClearGivenFor(changes, this.schedule.now()));
    }
    return this.alarm.read();
  }

  /**
   * As The Office starts again, before anything is released: while the alarm is on, pauses the
   * started Tasks a sounding the service stopped during left running. Nothing while it is off.
   */
  async finishSounding(): Promise<void> {
    if ((await this.alarm.read()).on) await this.pauseStartedTasks();
  }

  private async pauseStartedTasks(): Promise<void> {
    for (const { event } of await this.tasks.updateEveryStarted(pauseTaskForAlarm)) {
      await this.events.publish(event);
    }
  }
}

/** The Tasks the user holds or drops at the all clear, by id; every other one it paused resumes. */
export interface AllClearChoices {
  readonly hold: readonly string[];
  readonly drop: readonly string[];
}

function choiceFor(taskId: string, { hold, drop }: AllClearChoices): AllClearChoice {
  if (drop.includes(taskId)) return "drop";
  return hold.includes(taskId) ? "hold" : "resume";
}

function allClearGivenFor(
  changes: readonly TaskChange<DomainEvent>[],
  occurredAt: Date,
): AllClearGiven {
  const idsOf = (eventClass: abstract new (...args: never[]) => DomainEvent): string[] =>
    changes.filter(({ event }) => event instanceof eventClass).map(({ task }) => task.id);
  return new AllClearGiven(
    idsOf(TaskResumed),
    idsOf(TaskHeldAtAllClear),
    idsOf(TaskStateChanged),
    occurredAt,
  );
}
