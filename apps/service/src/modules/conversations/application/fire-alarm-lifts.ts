import { Injectable } from "@nestjs/common";
import { ThreadNotFound } from "../domain/thread-not-found.js";
import { ThreadRefused } from "../domain/thread-refused.js";
import { FireAlarmLiftRepository } from "../ports/fire-alarm-lift-repository.js";
import { ThreadRepository } from "../ports/thread-repository.js";
import { FireAlarmInThreads } from "./fire-alarm-in-threads.js";

/** What an Agent reads for a tool call while the fire alarm holds its Thread. */
export const HELD_BY_THE_FIRE_ALARM =
  "Refused by The Office: the fire alarm is on, so no Agent runs tools until the all clear. Answer in words; the user can let you act in this Thread.";

/**
 * Chats during the fire alarm (spec §2.8): Agents answer, but every tool call is refused, except
 * in a Thread the user lifted it for, until the all clear (a lift is kept for the sounding it was
 * made in).
 */
@Injectable()
export class FireAlarmLifts {
  constructor(
    private readonly fireAlarm: FireAlarmInThreads,
    private readonly lifts: FireAlarmLiftRepository,
    private readonly threads: ThreadRepository,
  ) {}

  /** The words refusing a tool call in the Thread now; undefined when the alarm holds none. */
  async heldReason(threadId: string): Promise<string | undefined> {
    const alarm = await this.fireAlarm.read();
    if (!alarm.on) return undefined;
    const lifted = await this.lifts.liftedIn(alarm.since);
    return lifted.includes(threadId) ? undefined : HELD_BY_THE_FIRE_ALARM;
  }

  /** The Threads whose Agent may act while the alarm is on; none while it is off. */
  async lifted(): Promise<readonly string[]> {
    const alarm = await this.fireAlarm.read();
    return alarm.on ? this.lifts.liftedIn(alarm.since) : [];
  }

  /** Lets the Thread's Agent act until the all clear. Refused while the alarm is off. */
  async lift(threadId: string): Promise<void> {
    if (!(await this.threads.find(threadId))) throw new ThreadNotFound(threadId);
    const alarm = await this.fireAlarm.read();
    if (!alarm.on) {
      throw new ThreadRefused(["The fire alarm isn't on: every Agent may act already."]);
    }
    await this.lifts.lift(threadId, alarm.since, new Date());
  }

  /** Takes the lift back: the Thread's tool calls are refused again while the alarm is on. */
  async takeBack(threadId: string): Promise<void> {
    if (!(await this.threads.find(threadId))) throw new ThreadNotFound(threadId);
    await this.lifts.takeBack(threadId);
  }
}
