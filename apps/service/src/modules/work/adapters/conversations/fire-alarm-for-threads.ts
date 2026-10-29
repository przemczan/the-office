import { Injectable, type OnModuleInit } from "@nestjs/common";
import { EventBus } from "../../../../platform/events/event-bus.js";
import { FireAlarmInThreads } from "../../../conversations/index.js";
import { FireAlarmService } from "../../application/fire-alarm-service.js";
import { AlarmSounded, AllClearGiven } from "../../domain/fire-alarm-events.js";

/**
 * Gives Conversations the fire alarm Work keeps, as Work starts, and tells it when the alarm
 * sounds and when the all clear is given (spec §2.8): Conversations can't ask Work, which calls it.
 */
@Injectable()
export class FireAlarmForThreads implements OnModuleInit {
  constructor(
    private readonly fireAlarm: FireAlarmService,
    private readonly inThreads: FireAlarmInThreads,
    private readonly events: EventBus,
  ) {}

  onModuleInit(): void {
    this.inThreads.readFrom(() => this.fireAlarm.read());
    this.events.subscribe(AlarmSounded, () => this.inThreads.sounded());
    // A held Task is the user's own Pause, which leaves its Consultations going on.
    this.events.subscribe(AllClearGiven, ({ resumed, held }) =>
      this.inThreads.allClear([...resumed, ...held]),
    );
  }
}
