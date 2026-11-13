import { Injectable } from "@nestjs/common";
import { PersonRecords } from "../../people/index.js";
import { decisionRecordText, type Mention, type MentionedRecord } from "../domain/mention.js";
import type { OpenPage, OpenPageRecord } from "../domain/open-page.js";
import { ProjectRecordSource } from "../ports/project-record-source.js";
import { ThreadRepository } from "../ports/thread-repository.js";
import { WorkRecords } from "./work-records.js";

/**
 * Reads the records the user mentions in a message, and the Open page's (spec §2.4): Decisions
 * from this module's own, Tasks, Initiatives and Ideas, people and Projects from the modules keeping
 * them.
 */
@Injectable()
export class MentionedRecords {
  constructor(
    private readonly repository: ThreadRepository,
    private readonly work: WorkRecords,
    private readonly people: PersonRecords,
    private readonly projects: ProjectRecordSource,
  ) {}

  /** Each mentioned record as it stands now, in the order mentioned. */
  async read(mentions: readonly Mention[]): Promise<MentionedRecord[]> {
    return Promise.all(
      mentions.map(async (mention) => ({ mention, text: await this.textOf(mention) })),
    );
  }

  /** The Open page's record as it stands now. */
  async openPage(page: OpenPage): Promise<OpenPageRecord> {
    return { page, text: await this.openPageText(page) };
  }

  private openPageText(page: OpenPage): Promise<string | undefined> {
    switch (page.kind) {
      case "task":
        return this.work.taskRecord(page.taskId);
      case "initiative":
        return this.work.initiativeRecord(page.initiativeId);
      case "idea":
        return this.work.ideaRecord(page.ideaId);
      case "person":
        return this.people.of(page.roleKey);
      case "project":
        return this.projects.of(page.projectId);
    }
  }

  private async textOf(mention: Mention): Promise<string | undefined> {
    switch (mention.kind) {
      case "task":
        return this.work.taskRecord(mention.taskId);
      case "initiative":
        return this.work.initiativeRecord(mention.initiativeId);
      case "idea":
        return this.work.ideaRecord(mention.ideaId);
      case "decision": {
        const decision = await this.repository.decision(mention.decisionId);
        if (!decision) return undefined;
        const taskRecord =
          decision.taskId === undefined ? undefined : await this.work.taskRecord(decision.taskId);
        return decisionRecordText(decision, taskRecord);
      }
    }
  }
}
