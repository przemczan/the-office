import { DomainEvent } from "../../../platform/events/domain-event.js";

/** A Task has its own Stages, copied from the library Pipeline it follows. */
export class TaskStagesMade extends DomainEvent {
  constructor(
    readonly taskId: string,
    readonly pipelineId: string,
  ) {
    super();
  }
}

/** The user edited a Task's own Stages for that Task; the library Pipeline stays as it is. */
export class TaskStagesEdited extends DomainEvent {
  constructor(
    readonly taskId: string,
    readonly pipelineId: string,
  ) {
    super();
  }
}
