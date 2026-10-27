import { isDeepStrictEqual } from "node:util";
import type { RoleCard } from "../../people/index.js";
import { ProposalRefused } from "./proposal-refused.js";

/**
 * What a Proposal can change, by kind; the module that owns each kind applies it. A kind of change
 * joins here with its applier, so a Proposal can change anything the user confirms.
 */
export interface ProposedChanges {
  readonly hire: ProposedHire;
  readonly change: ProposedRoleChange;
}

/** The kinds of change a Proposal can carry. */
export type ProposedChangeKind = keyof ProposedChanges;

/** What a Proposal changes. */
export type ProposedChange = ProposedChanges[ProposedChangeKind];

/** The fields of a Role card a change rewrites, each one given whole. */
export type RoleCardFields = Partial<RoleCard>;

/** A new Role: its whole card and the library skills it has besides the skills for everyone. */
export interface ProposedHire {
  readonly kind: "hire";
  readonly card: RoleCard;
  readonly skills: readonly string[];
  /** The Role the person was hired into, once the user applied it; undefined before. */
  readonly roleKey: string | undefined;
}

/**
 * A change to a hired Role's card: the fields it rewrites as the card had them when the Proposal
 * was drafted (`from`), and as proposed (`to`). Applying rewrites only those fields on the card as
 * it is then.
 */
export interface ProposedRoleChange {
  readonly kind: "change";
  readonly roleKey: string;
  readonly from: RoleCardFields;
  readonly to: RoleCardFields;
}

/** Open until the user applies it or declines it; nothing changes before they apply it. */
export type ProposalStatus =
  | { readonly kind: "open" }
  | { readonly kind: "applied"; readonly at: Date }
  | { readonly kind: "declined"; readonly at: Date };

/**
 * A change a person drafts for the user to confirm with a click (spec §2.2), shown as a card in
 * the Thread it was drafted in. It takes effect only when the user applies it.
 */
export interface Proposal {
  readonly id: string;
  readonly threadId: string;
  /** Who drafted it, by the key of their Role. */
  readonly draftedBy: string;
  readonly draftedAt: Date;
  /** As drafted while open; as applied, with the user's edits, once applied. */
  readonly change: ProposedChange;
  readonly status: ProposalStatus;
}

/** The new Role's card and skills as the user edited them before hiring. */
export interface EditedHire {
  readonly card: RoleCard;
  readonly skills: readonly string[];
}

/**
 * A change to the Role keyed `roleKey`, whose card is `card` now: the fields of `fields` that differ
 * from the card, each with the card's value as it was then.
 */
export function proposedRoleChange(
  roleKey: string,
  card: RoleCard,
  fields: RoleCardFields,
): ProposedRoleChange {
  const changed = (Object.keys(fields) as (keyof RoleCard)[]).filter(
    (field) => fields[field] !== undefined && !isDeepStrictEqual(fields[field], card[field]),
  );
  return { kind: "change", roleKey, from: fieldsOf(card, changed), to: fieldsOf(fields, changed) };
}

function fieldsOf(source: RoleCardFields, fields: readonly (keyof RoleCard)[]): RoleCardFields {
  // Each entry keeps its own field's value, which Object.fromEntries' type can't say.
  return Object.fromEntries(fields.map((field) => [field, source[field]])) as RoleCardFields;
}

/** Every problem with what is proposed that its owner doesn't judge, in words the drafter acts on. */
export function proposedChangeProblems(change: ProposedChange): string[] {
  if (change.kind === "hire") return [];
  return Object.keys(change.to).length === 0
    ? ["Nothing changes: give the fields of the Role card that change, each one whole."]
    : [];
}

/**
 * The change to apply: as drafted, or, for a new Role, with the card the user edited before
 * hiring. Refused once the Proposal is applied or declined, and for an edit of anything else.
 */
export function changeToApply(proposal: Proposal, edited: EditedHire | undefined): ProposedChange {
  refuseUnlessOpen(proposal);
  if (!edited) return proposal.change;
  if (proposal.change.kind !== "hire") {
    throw new ProposalRefused(["Only a new Role's card is edited before hiring."]);
  }
  return { ...proposal.change, card: edited.card, skills: edited.skills };
}

/** Refuses a change of a Proposal the user applied or declined already. */
export function refuseUnlessOpen({ status }: Proposal): void {
  if (status.kind === "applied") throw new ProposalRefused(["This Proposal is applied already."]);
  if (status.kind === "declined") throw new ProposalRefused(["This Proposal was declined."]);
}
