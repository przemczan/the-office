import { canonicalJson, fingerprintOf } from "../../engine/index.domain.js";
import {
  ASK_ME,
  type AuthorityGroup,
  type AuthorityInEffect,
  type AuthoritySetting,
  type AuthorityValue,
  type HardSwitchValue,
  heldToCap,
} from "../../people/index.domain.js";

/** What the person's Authority makes of a call of an Office tool (spec 6 › Authority). */
export type ToolRuling =
  | { readonly kind: "run" }
  | { readonly kind: "never" }
  /** Approval comes first, put as `setting` (Ask me, or Consult a person) says. */
  | { readonly kind: "hold"; readonly setting: HardSwitchValue }
  /** A Proposal is drafted for the user to apply, and the call is answered at once. */
  | { readonly kind: "propose" };

/**
 * The value that rules a call: a row's one value, or its own or others' value by whose work the
 * call's subject is.
 */
export function valueOnSubject(setting: AuthoritySetting, ownWork: boolean): AuthorityValue {
  if (setting.kind !== "own-and-others") return setting;
  return ownWork ? setting.own : setting.others;
}

/** The value of a row that rules calls on the person's own work, held to the row's cap. */
export function ownWorkValue(group: AuthorityGroup, setting: AuthoritySetting): AuthorityValue {
  return heldToCap(group, valueOnSubject(setting, true));
}

/** The value as a call under a floor of Proposal reads it: Allowed becomes Proposal, the rest stay. */
export function atLeastProposal(value: AuthorityValue): AuthorityValue {
  return value.kind === "allowed" ? { kind: "proposal" } : value;
}

/** Whether the tool is offered at all: unless its setting is Never on every subject. */
export function isOffered(setting: AuthoritySetting): boolean {
  if (setting.kind === "own-and-others") {
    return setting.own.kind !== "never" || setting.others.kind !== "never";
  }
  return setting.kind !== "never";
}

/**
 * What a value makes of a call (spec 5.4.1 › One ruling step). Ask me reads the same in a
 * Consultation, where the approval goes to the user, the one person a Consultation can always ask.
 * A duty grants nothing: a row at Never is never allowed (spec 6, "A person's Office tools").
 */
export function toolRuling(value: AuthorityValue): ToolRuling {
  switch (value.kind) {
    case "allowed":
      return { kind: "run" };
    case "never":
      return { kind: "never" };
    case "proposal":
      return { kind: "propose" };
    case "ask-me":
      return { kind: "hold", setting: ASK_ME };
    case "consult":
      return { kind: "hold", setting: value };
  }
}

/**
 * The call in the words its approval is keyed by: the tool and its input in canonical form, so the
 * same call with its fields in another order finds the same approval. A call that gives a Secret
 * value is worded with its input as shown (`shown`, no value in it) and the hash of the whole input,
 * so the card names the secret only and another value is another call.
 */
export function officeToolCallWords(
  action: string,
  input: unknown,
  secret?: { readonly shown: unknown },
): string {
  if (secret === undefined) return canonicalJson({ action, input });
  return canonicalJson({ action, input: secret.shown, secretsHash: fingerprintOf(input) });
}

/** How strictly each kind of value rules a call, the strictest first. */
const STRICTNESS: readonly AuthorityValue["kind"][] = [
  "never",
  "proposal",
  "ask-me",
  "consult",
  "allowed",
];

/** The strictest of the values that rule the sections of one call. */
export function strictestValue(values: readonly AuthorityValue[]): AuthorityValue {
  const [strictest] = values.toSorted(
    (first, second) => STRICTNESS.indexOf(first.kind) - STRICTNESS.indexOf(second.kind),
  );
  if (strictest === undefined) throw new Error("A call is ruled by at least one group.");
  return strictest;
}

/**
 * The tools among `names` the person's Authority leaves offered: all but those ruled Never
 * (`groupOf` names the Authority group of each tool that has one: the Office actions' and the
 * hand-written tools'), a tool in no group being Core. A duty never keeps one offered.
 */
export function offeredTools(
  names: readonly string[],
  groupOf: ReadonlyMap<string, AuthorityGroup>,
  authority: AuthorityInEffect,
  ownWorkGroupOf: ReadonlyMap<string, AuthorityGroup> = new Map(),
): string[] {
  return names.filter((name) => {
    const group = groupOf.get(name);
    if (group === undefined || isOffered(authority[group])) return true;
    // A tool with a row of its own on own work is offered while that row isn't Never.
    const ownWorkGroup = ownWorkGroupOf.get(name);
    return ownWorkGroup !== undefined && isOffered(authority[ownWorkGroup]);
  });
}
