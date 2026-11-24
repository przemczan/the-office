import type { EditedRecord, RecordEdit } from "../domain/record-edits.js";

/**
 * The kept edits of Tasks, Ideas and Initiatives, which their repositories save with each change that
 * makes them (`edits` on the change), read here for a record's History.
 */
export abstract class RecordEdits {
  /** The record's kept edits, in the order they were saved; none for a record nobody edited. */
  abstract of(record: EditedRecord): Promise<readonly RecordEdit[]>;
}
