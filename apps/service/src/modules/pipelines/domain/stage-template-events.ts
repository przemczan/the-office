import { DomainEvent } from "../../../platform/events/domain-event.js";

/** The user made a Stage template in the library, from scratch or from a Stage. */
export class StageTemplateAdded extends DomainEvent {
  constructor(readonly stageTemplateId: string) {
    super();
  }
}

/** The user saved a Stage template; Pipelines and Tasks it was added to keep their copy. */
export class StageTemplateSaved extends DomainEvent {
  constructor(readonly stageTemplateId: string) {
    super();
  }
}

/** The user removed a Stage template from the library; nothing points at it. */
export class StageTemplateRemoved extends DomainEvent {
  constructor(readonly stageTemplateId: string) {
    super();
  }
}
