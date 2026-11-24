import { Inject, Injectable } from "@nestjs/common";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type { EditedRecord, RecordEdit } from "../../domain/record-edits.js";
import { RecordEdits } from "../../ports/record-edits.js";
import { editsOf } from "./work-rows.js";

/** The kept edits in `record_edits`, which the Work repositories write with each change. */
@Injectable()
export class PostgresRecordEdits extends RecordEdits {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  of(record: EditedRecord): Promise<readonly RecordEdit[]> {
    return editsOf(this.database, record);
  }
}
