/** The kinds of work a scheduled Office update waits for (spec §5.1 Defaults, "Updating The Office"). */
export type BusyKind =
  "turn" | "script-stage" | "publish" | "clone" | "environment-check" | "run-environment";

/** One piece of work going on now, which a scheduled Office update waits for. */
export interface BusyItem {
  readonly kind: BusyKind;
  /** What it is, in the UI's words, such as "Jim's turn in Implement on the Task 'Add login'". */
  readonly label: string;
}
