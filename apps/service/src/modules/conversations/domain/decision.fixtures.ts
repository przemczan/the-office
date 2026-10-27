import type { Decision } from "./decision.js";

/** A Decision the Planner opened on a Task, waiting on the user. */
export function aDecision(fields: Partial<Decision> = {}): Decision {
  return {
    id: crypto.randomUUID(),
    threadId: "8f0b1a52-3c1e-4a4e-9d0e-1f5b6c7d8e9f",
    taskId: "3b1f6f0e-2a4d-4c8e-9f1a-7d2e5c6b8a90",
    roleKey: "planner",
    question: "Should the export include archived Projects?",
    context: "The export reads every Project; archived ones have no worktree.",
    options: ["Only active Projects", "Every Project"],
    recommendation: { option: 0, reason: "Archived Projects have nothing to export." },
    askedAt: new Date("2026-10-25T09:02:00.000Z"),
    passedOn: [],
    answer: undefined,
    ...fields,
  };
}
