import { z } from "zod";

/**
 * A Task's and an Initiative's states, apart from the rest of Work's contract so the engines'
 * contract can name them without importing it back (`work.ts` imports `engines.ts`). `work.ts`
 * re-exports them.
 */

export const initiativeStateSchema = z.enum(["shaping", "active", "done", "dropped"]);
export type InitiativeState = z.infer<typeof initiativeStateSchema>;

export const taskStateSchema = z.enum([
  "shaping",
  "backlog",
  "planning",
  "ready",
  "in-progress",
  "waiting-on-you",
  "paused",
  "done",
  "dropped",
]);
export type TaskState = z.infer<typeof taskStateSchema>;
