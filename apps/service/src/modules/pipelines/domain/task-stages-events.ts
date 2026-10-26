import { DomainEvent } from "../../../platform/events/domain-event.js";

/** A started Task has its own Stages, copied from the library Pipeline it follows. */
export class TaskStagesMade extends DomainEvent {
  constructor(
    readonly taskId: string,
    readonly pipelineId: string,
  ) {
    super();
  }
}
