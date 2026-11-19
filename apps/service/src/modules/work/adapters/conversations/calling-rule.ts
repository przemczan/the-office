import { CALLING_RULE } from "../../../conversations/index.js";

/**
 * A Work Thread's instructions as its session gets them: the rendered text, then Conversations'
 * rule to call a person only when the user asks, which stays outside the templates.
 */
export function withCallingRule(instructions: string): string {
  return `${instructions}\n\n${CALLING_RULE}`;
}
