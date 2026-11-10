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
