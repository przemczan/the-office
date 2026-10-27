import type { HardSwitchValue } from "../../people/index.js";

/** What a call behind an enforced Hard switch is to do before it runs (spec §6). */
export type HeldCallRuling =
  | { readonly kind: "proceed" }
  | { readonly kind: "refuse"; readonly reason: string }
  /** Approval is asked first, of `person` (a Role's title) or of the user when undefined. */
  | { readonly kind: "ask"; readonly person: string | undefined };

/**
 * What the switch's value in effect (a Consult of a Role nobody fills already reads as Ask me)
 * makes of a call: run it, refuse it with a reason the Agent reads, or ask approval first.
 */
export function heldCallRuling(
  switchLabel: string,
  inEffect: HardSwitchValue,
  titleOf: (roleKey: string) => string,
): HeldCallRuling {
  switch (inEffect.kind) {
    case "allowed":
      return { kind: "proceed" };
    case "never":
      return {
        kind: "refuse",
        reason: `Not allowed for you: ${switchLabel} is Never on your Role card. Open a Decision if you need it.`,
      };
    case "ask-me":
      return { kind: "ask", person: undefined };
    case "consult":
      return { kind: "ask", person: titleOf(inEffect.role) };
  }
}
