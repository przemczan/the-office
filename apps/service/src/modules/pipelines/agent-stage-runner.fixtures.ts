import { type SessionScript } from "../engine/index.js";
import { anAgentStage, aTurn } from "./pipelines-application.fixtures.js";

export const implement = anAgentStage("implement", {
  name: "Implement",
  brief: "Implement the Plan until the Definition of Done is met.",
});

/** A session whose first result is `first`, corrected once to `corrected`. */
export function corrected(first: unknown, second: unknown): SessionScript {
  return [
    { step: "start", brief: { id: "brief", text: "" } },
    aTurn(first),
    { step: "send", message: { id: "correction", text: "" }, priority: "later" },
    aTurn(second),
    { step: "end" },
  ];
}

/** When the used-up window of `aRefusedTurn` resets. */
export const WINDOW_RESET = new Date("2026-11-13T14:00:00.000Z");

/** A turn the engine refused because its account's 5-hour window is used up (spec 5.4). */
export function aRefusedTurn(): SessionScript[number] {
  return {
    step: "event",
    event: {
      kind: "turn-ended",
      outcome: "usage-window-used-up",
      consumedMessageIds: [],
      usage: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
      sessionCostUsd: 0,
      output: undefined,
      errors: ["You've hit your limit · resets 2pm (UTC)"],
      usedUpWindow: { window: "five-hour", resetsAt: WINDOW_RESET, resetGiven: true },
    },
  };
}

/** A session whose first turn the engine refuses. */
export const A_REFUSED_SESSION: SessionScript = [
  { step: "start", brief: { id: "brief", text: "" } },
  aRefusedTurn(),
  { step: "end" },
];

/** A session whose first result is `first`, and whose correction the engine refuses. */
export function refusedCorrection(first: unknown): SessionScript {
  return [
    { step: "start", brief: { id: "brief", text: "" } },
    aTurn(first),
    { step: "send", message: { id: "correction", text: "" }, priority: "later" },
    aRefusedTurn(),
    { step: "end" },
  ];
}
