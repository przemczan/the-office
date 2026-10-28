import { Injectable } from "@nestjs/common";

/**
 * The records of Tasks, Initiatives and Ideas as an Agent reads them; undefined when there is no
 * such one.
 */
export interface WorkRecordSource {
  taskRecord(taskId: string): Promise<string | undefined>;
  /** The Task's title, which a Link card's note links to it by. */
  taskTitle(taskId: string): Promise<string | undefined>;
  initiativeRecord(initiativeId: string): Promise<string | undefined>;
  ideaRecord(ideaId: string): Promise<string | undefined>;
}

/**
 * Where the module keeping Tasks, Initiatives and Ideas gives Conversations their records, for the ones the user
 * mentions in a message and the Tasks a Link card is about. That module calls Conversations to open its Threads, so it registers here
 * instead of being called through a port, as with TaskThreadSetups.
 */
@Injectable()
export class WorkRecords implements WorkRecordSource {
  private source: WorkRecordSource | undefined;

  provide(source: WorkRecordSource): void {
    if (this.source) throw new Error("Work's records come from one module only.");
    this.source = source;
  }

  taskRecord(taskId: string): Promise<string | undefined> {
    return this.registered().taskRecord(taskId);
  }

  taskTitle(taskId: string): Promise<string | undefined> {
    return this.registered().taskTitle(taskId);
  }

  initiativeRecord(initiativeId: string): Promise<string | undefined> {
    return this.registered().initiativeRecord(initiativeId);
  }

  ideaRecord(ideaId: string): Promise<string | undefined> {
    return this.registered().ideaRecord(ideaId);
  }

  private registered(): WorkRecordSource {
    if (!this.source) throw new Error("No module gives Work's records.");
    return this.source;
  }
}
