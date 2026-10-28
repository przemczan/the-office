import { DomainEvent } from "../../../platform/events/domain-event.js";

/** The user made a Pipeline in the library, from scratch or as a copy. */
export class PipelineAdded extends DomainEvent {
  constructor(readonly pipelineId: string) {
    super();
  }
}

/** The user saved a library Pipeline: Tasks that haven't started and follow it change with it. */
export class PipelineSaved extends DomainEvent {
  constructor(readonly pipelineId: string) {
    super();
  }
}

/** The user removed a Pipeline from the library; Tasks that started on it keep their copy. */
export class PipelineRemoved extends DomainEvent {
  constructor(readonly pipelineId: string) {
    super();
  }
}
