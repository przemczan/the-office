import type { WorkFilter } from "@the-office/contracts";

/**
 * The groups of a person's Work tab, in their order, as the user reads them. The service tells
 * which Tasks each holds and counts them (`GET /roles/:roleKey/tasks`).
 */
export const WORK_FILTERS: readonly { readonly key: WorkFilter; readonly label: string }[] = [
  { key: "all", label: "All" },
  { key: "not-started", label: "Not started" },
  { key: "in-progress", label: "In progress" },
  { key: "waiting-on-you", label: "Waiting on you" },
  { key: "done", label: "Done" },
  { key: "dropped", label: "Dropped" },
];
