import { Injectable } from "@nestjs/common";
import type { OfficeActionSubject } from "@the-office/contracts";
import type { OfficeActionSubjectSnapshot } from "../../../engine/index.js";
import { IdeaService } from "../../application/idea-service.js";
import { InitiativeService } from "../../application/initiative-service.js";
import { TaskService } from "../../application/task-service.js";

/**
 * The records Work's Office actions act on, as a Proposal reads them (`officeActionDraft`): what
 * each action's handler decides by (a Task's state, whether it is archived) and the value of each
 * field an action writes. A Proposal's fingerprint is made of these, so a change to any of them
 * since the draft is a change to the subject.
 */
@Injectable()
export class WorkSubjectSnapshots {
  constructor(
    private readonly tasks: TaskService,
    private readonly initiatives: InitiativeService,
    private readonly ideas: IdeaService,
  ) {}

  async of({ kind, id }: OfficeActionSubject): Promise<OfficeActionSubjectSnapshot> {
    switch (kind) {
      case "task": {
        const task = await this.tasks.read(id);
        return {
          title: task.title,
          decidedBy: { state: task.state, archived: task.archivedAt !== undefined },
          values: {
            title: task.title,
            description: task.description,
            kind: task.kind,
            priority: task.priority,
            plan: task.plan,
            definitionOfDone: task.definitionOfDone,
            projectId: task.projectId,
            pipelineId: task.pipelineId,
          },
        };
      }
      case "initiative": {
        const initiative = await this.initiatives.read(id);
        return {
          title: initiative.name,
          decidedBy: { state: initiative.state, archived: initiative.archivedAt !== undefined },
          values: {
            outcome: initiative.outcome,
            shortName: initiative.shortName,
            engineId: initiative.engineOverride,
          },
        };
      }
      case "idea": {
        const idea = await this.ideas.read(id);
        return {
          title: idea.title,
          decidedBy: { state: idea.state },
          values: { title: idea.title, notes: idea.notes, projectId: idea.projectId },
        };
      }
      default:
        // A record Work keeps no title of, such as a saved view named by its id.
        return { title: id, decidedBy: {}, values: {} };
    }
  }
}
