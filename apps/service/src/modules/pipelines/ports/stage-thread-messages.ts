/** The messages an Agent Stage's run logged in its Stage Thread, from its start to its end. */
export interface StageRunThreadWindow {
  readonly taskId: string;
  readonly threadId: string;
  readonly from: Date;
  readonly to: Date;
}

/**
 * A Stage Thread's messages, which Conversations keeps and words as `read_threads` does; the
 * composition root binds it. `read_stage_history` reads them for an Agent Stage's run.
 */
export abstract class StageThreadMessages {
  /**
   * The messages logged in the window as text no longer than `limit`: a cut one says how many are
   * left out and how to read on.
   */
  abstract words(window: StageRunThreadWindow, limit: number): Promise<string>;

  /** How many messages were logged in the window, without reading them. */
  abstract count(window: StageRunThreadWindow): Promise<number>;
}
