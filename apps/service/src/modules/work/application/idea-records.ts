import { Injectable } from "@nestjs/common";
import type { Idea } from "../domain/idea.js";
import { ideaRecordText, type ShapedInto } from "../domain/record-words.js";
import { AttachmentService } from "./attachment-service.js";
import { IdeaService } from "./idea-service.js";
import { InitiativeService } from "./initiative-service.js";
import { TaskService } from "./task-service.js";

/** The Ideas' records, as an Agent reads one. */
@Injectable()
export class IdeaRecords {
  constructor(
    private readonly ideas: IdeaService,
    private readonly tasks: TaskService,
    private readonly initiatives: InitiativeService,
    private readonly attachments: AttachmentService,
  ) {}

  /**
   * The Idea's record as an Agent reads it, through `read_idea` or mentioned in a chat. Throws
   * IdeaNotFound when there is no such Idea.
   */
  async recordText(ideaId: string): Promise<string> {
    const idea = await this.ideas.read(ideaId);
    const [shapedInto, attachments, edits] = await Promise.all([
      this.shapedInto(idea),
      this.attachments.listOf({ kind: "idea", ideaId }),
      this.ideas.editsOf(ideaId),
    ]);
    return ideaRecordText(idea, shapedInto, attachments, edits);
  }

  private async shapedInto({ taskId, initiativeId }: Idea): Promise<ShapedInto | undefined> {
    if (taskId !== undefined) return { kind: "task", task: await this.tasks.read(taskId) };
    if (initiativeId === undefined) return undefined;
    return { kind: "initiative", initiative: await this.initiatives.read(initiativeId) };
  }
}
