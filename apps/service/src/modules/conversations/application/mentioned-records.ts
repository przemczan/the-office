import { Injectable } from "@nestjs/common";
import { decisionRecordText, type Mention, type MentionedRecord } from "../domain/mention.js";
import { ThreadRepository } from "../ports/thread-repository.js";
import { WorkRecords } from "./work-records.js";

/**
 * Reads the records the user mentions in a message (spec §2.4): Decisions from this module's own,
 * Tasks and Ideas from the module keeping them.
 */
@Injectable()
export class MentionedRecords {
  constructor(
    private readonly repository: ThreadRepository,
    private readonly work: WorkRecords,
  ) {}

  /** Each mentioned record as it stands now, in the order mentioned. */
  async read(mentions: readonly Mention[]): Promise<MentionedRecord[]> {
    return Promise.all(
      mentions.map(async (mention) => ({ mention, text: await this.textOf(mention) })),
    );
  }

  private async textOf(mention: Mention): Promise<string | undefined> {
    switch (mention.kind) {
      case "task":
        return this.work.taskRecord(mention.taskId);
      case "idea":
        return this.work.ideaRecord(mention.ideaId);
      case "decision": {
        const decision = await this.repository.decision(mention.decisionId);
        if (!decision) return undefined;
        return decisionRecordText(decision, await this.work.taskRecord(decision.taskId));
      }
    }
  }
}
