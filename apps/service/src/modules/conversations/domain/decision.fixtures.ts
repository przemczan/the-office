import type { ContextDecision } from "./context-policy.js";
import type { Decision, DecisionDraft, DecisionQuestion } from "./decision.js";
import type { ThreadSession } from "./thread.js";
import { ThreadRefused } from "./thread-refused.js";

/** A Decision the Planner opened on a Task, waiting on the user. */
export function aDecision(fields: Partial<Decision> = {}): Decision {
  return {
    kind: "form",
    id: crypto.randomUUID(),
    threadId: "8f0b1a52-3c1e-4a4e-9d0e-1f5b6c7d8e9f",
    taskId: "3b1f6f0e-2a4d-4c8e-9f1a-7d2e5c6b8a90",
    roleKey: "planner",
    context: "The export reads every Project; archived ones have no worktree.",
    questions: [
      {
        kind: "choice",
        question: "Should the export include archived Projects?",
        options: ["Only active Projects", "Every Project"],
        recommendation: { option: 0, reason: "Archived Projects have nothing to export." },
      },
    ],
    askedAt: new Date("2026-10-25T09:02:00.000Z"),
    attachmentIds: [],
    passedOn: [],
    answer: undefined,
    inStageThread: false,
    ...fields,
  };
}

// What decision.test.ts and decision.full.test.ts share besides.

export const AT = new Date("2026-10-25T10:00:00.000Z");

export const TASK_HOME = { kind: "task", taskId: "task-1" } as const;

export const SESSION: ThreadSession = {
  id: "session-1",
  roleKey: "planner",
  engineId: "claude-code",
  cardVersion: 1,
  officeInstructionsVersion: 0,
  startedAt: AT,
  lastCallAt: AT,
  contextTokens: 34_000,
  startContextTokens: 33_000,
  full: false,
  changesAllowed: false,
};

export const DRAFT: DecisionDraft = {
  context: "Archived Projects have no worktree.",
  questions: [
    {
      kind: "choice",
      question: "Should the export include archived Projects?",
      options: ["Only active Projects", "Every Project"],
      recommendation: { option: 0, reason: "Archived ones have nothing to export." },
    },
  ],
};

/** A form of three questions: two choices around an open question. */
export const THREE_QUESTIONS: readonly DecisionQuestion[] = [
  {
    kind: "choice",
    question: "Should the export include archived Projects?",
    options: ["Only active Projects", "Every Project"],
    recommendation: { option: 0, reason: "Archived Projects have nothing to export." },
  },
  { kind: "open", question: "Which years should it cover?" },
  {
    kind: "choice",
    question: "Which format?",
    options: ["CSV", "JSON"],
    recommendation: { option: 1, reason: "It keeps the nesting." },
  },
];

export const WARM: ContextDecision = {
  move: "resume",
  reason: "cache-warm",
  cacheWarm: true,
  cacheWarmUntil: undefined,
  contextTokens: 34_000,
  briefTokens: undefined,
  alternatives: [],
};

export function refusalOf(change: () => unknown): readonly string[] {
  try {
    change();
  } catch (error) {
    if (error instanceof ThreadRefused) return error.reasons;
    throw error;
  }
  throw new Error("It wasn't refused.");
}
