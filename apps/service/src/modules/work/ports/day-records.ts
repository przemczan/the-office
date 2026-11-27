/** One office day's span: from `start`, which is in it, to `end`, which is not. */
export interface DayRange {
  readonly start: Date;
  readonly end: Date;
}

/** A record, by its id, and when it happened in the day. */
export interface DayRecordMoment {
  readonly id: string;
  readonly at: Date;
}

/**
 * What Work's own records say happened in a day, as ids and moments: the Days read joins them to
 * the records. Archived Tasks and Initiatives are included, newest first, each record once.
 */
export abstract class DayRecords {
  /** Tasks that moved to Done in the day. */
  abstract tasksDone(range: DayRange): Promise<readonly DayRecordMoment[]>;
  /** Tasks that moved to Dropped in the day. */
  abstract tasksDropped(range: DayRange): Promise<readonly DayRecordMoment[]>;
  /** Tasks whose first move to In progress was in the day. */
  abstract tasksStarted(range: DayRange): Promise<readonly DayRecordMoment[]>;
  /** Tasks whose pull request was merged in the day. */
  abstract pullRequestsMerged(range: DayRange): Promise<readonly DayRecordMoment[]>;
  /** Initiatives that ended Done in the day. */
  abstract initiativesDone(range: DayRange): Promise<readonly DayRecordMoment[]>;
  /** Ideas captured in the day. */
  abstract ideasCaptured(range: DayRange): Promise<readonly DayRecordMoment[]>;
}
