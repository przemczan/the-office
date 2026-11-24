import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../../platform/events/event-bus.js";
import { ProjectActionsChanged, ProjectFeaturesChanged } from "../../../projects/index.js";
import { AlarmSounded } from "../../../work/index.js";
import { ActionRunSignals } from "../../ports/action-run-signals.js";

/** Work's and Projects' domain events that stop or remove runs. */
@Injectable()
export class DomainEventSignals extends ActionRunSignals {
  constructor(private readonly events: EventBus) {
    super();
  }

  onAlarmSoundedAsap(listener: () => void): void {
    this.events.subscribe(AlarmSounded, ({ way }) => {
      if (way === "asap") listener();
    });
  }

  onActionsSwitchedOff(listener: (projectId: string) => void): void {
    this.events.subscribe(ProjectFeaturesChanged, ({ projectId, features }) => {
      if (!features.actions) listener(projectId);
    });
  }

  onActionsRemoved(listener: (projectId: string, actionKeys: readonly string[]) => void): void {
    this.events.subscribe(ProjectActionsChanged, ({ projectId, removedKeys }) => {
      if (removedKeys.length > 0) listener(projectId, removedKeys);
    });
  }
}
