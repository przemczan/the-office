import { Injectable } from "@nestjs/common";

/** The records of Tasks and Ideas as an Agent reads them; undefined when there is no such one. */
export interface WorkRecordSource {
  taskRecord(taskId: string): Promise<string | undefined>;
  ideaRecord(ideaId: string): Promise<string | undefined>;
}

/**
 * Where the module keeping Tasks and Ideas gives Conversations their records, for the ones the user
 * mentions in a message. That module calls Conversations to open its Threads, so it registers here
 * instead of being called through a port, as with TaskThreadSetups.
 */
@Injectable()
export class WorkRecords implements WorkRecordSource {
  private source: WorkRecordSource | undefined;

  provide(source: WorkRecordSource): void {
    if (this.source) throw new Error("Tasks' and Ideas' records come from one module only.");
    this.source = source;
  }

  taskRecord(taskId: string): Promise<string | undefined> {
    return this.registered().taskRecord(taskId);
  }

  ideaRecord(ideaId: string): Promise<string | undefined> {
    return this.registered().ideaRecord(ideaId);
  }

  private registered(): WorkRecordSource {
    if (!this.source) throw new Error("No module gives the records of Tasks and Ideas.");
    return this.source;
  }
}
