import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { Schedule } from "../../../platform/schedule/schedule.js";
import { hardStopAt, type FireAlarm } from "../domain/fire-alarm.js";
import { AlarmSounded } from "../domain/fire-alarm-events.js";
import { pauseTaskForAlarm } from "../domain/task-changes.js";
import { FireAlarmRepository } from "../ports/fire-alarm-repository.js";
import { TaskRepository } from "../ports/task-repository.js";

/**
 * The fire alarm (spec §2.8): sounding it pauses every Task In progress or Waiting on you as paused
 * by the alarm, which Pipelines holds at the next safe point; Start holds while it is on.
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
