import { dutyActionTools } from "./duty-action-tools.js";
import type { HeldDuties } from "./session-instructions.js";
import {
  ASK_ME,
  type AuthorityGroup,
  type AuthorityInEffect,
  type AuthoritySetting,
  type AuthorityValue,
  type HardSwitchValue,
} from "../../people/index.js";

/** What the person's Authority makes of a call of an Office tool (spec 6 › Authority). */
export type ToolRuling =
  | { readonly kind: "run" }
  | { readonly kind: "never" }
  /** Approval comes first, put as `setting` (Ask me, or Consult a person) says. */
  | { readonly kind: "hold"; readonly setting: HardSwitchValue };

/**
 * The value that rules a call: a row's one value, or its own or others' value by whose work the
 * call's subject is.
 */
export function valueOnSubject(setting: AuthoritySetting, ownWork: boolean): AuthorityValue {
  if (setting.kind !== "own-and-others") return setting;
  return ownWork ? setting.own : setting.others;
}

/** Whether the tool is offered at all: unless its setting is Never on every subject. */
export function isOffered(setting: AuthoritySetting): boolean {
  if (setting.kind === "own-and-others") {
    return setting.own.kind !== "never" || setting.others.kind !== "never";
  }
  return setting.kind !== "never";
}

/**
 * What a value makes of a call. A Proposal is held as Ask me until "Generic Office action
 * Proposal" drafts it instead (spec 5.4.1 › One ruling step). Ask me reads the same in a
 * Consultation, where the approval goes to the user, the one person a Consultation can always ask.
 * `dutyHolder` is whether the person holds a duty that grants the tool, which keeps it offered and
 * allowed where the row says Never, until "People and Memory for Agents" removes the duties' tools.
 */
export function toolRuling(value: AuthorityValue, dutyHolder: boolean): ToolRuling {
  switch (value.kind) {
    case "allowed":
      return { kind: "run" };
    case "never":
      return dutyHolder ? { kind: "run" } : { kind: "never" };
    case "ask-me":
    case "proposal":
      return { kind: "hold", setting: ASK_ME };
    case "consult":
      return { kind: "hold", setting: value };
  }
}

/** JSON with every object's keys sorted and no whitespace, so equal inputs read equal. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortedKeys(value));
}

function sortedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedKeys);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, each]) => each !== undefined)
      .toSorted(([first], [second]) => (first < second ? -1 : first > second ? 1 : 0))
      .map(([key, each]) => [key, sortedKeys(each)]),
  );
}

/**
 * The call in the words its approval is keyed by: the tool and its input in canonical form, so the
 * same call with its fields in another order finds the same approval.
 */
export function officeToolCallWords(action: string, input: unknown): string {
  return canonicalJson({ action, input });
}

/**
 * The tools among `names` the person's Authority leaves offered: all but the Office actions' tools
 * ruled Never (`groupOf` names the Authority group of each), those a held duty grants kept.
 */
export function offeredTools(
  names: readonly string[],
  groupOf: ReadonlyMap<string, AuthorityGroup>,
  authority: AuthorityInEffect,
  held: HeldDuties,
): string[] {
  const grantedByDuty = dutyActionTools(held);
  return names.filter((name) => {
    const group = groupOf.get(name);
    return group === undefined || grantedByDuty.has(name) || isOffered(authority[group]);
  });
}
