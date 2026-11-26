import {
  authorityGroupSchema,
  type AuthorityArea,
  type AuthorityInEffect,
  type AuthorityRow,
} from "@the-office/contracts";
import { AUTHORITY_ROW_LABELS } from "./role-card-words.ts";

/** Every row Never: what a fixture's Role stands at when its Authority doesn't matter. */
export const NEVER_EVERYWHERE: AuthorityInEffect = Object.fromEntries(
  authorityGroupSchema.options.map((group) => [group, { kind: "never" }]),
) as AuthorityInEffect;

const ALL_VALUES: AuthorityRow["values"] = ["allowed", "consult", "ask-me", "proposal", "never"];
const CAPPED_VALUES: AuthorityRow["values"] = ["proposal", "ask-me", "never"];

function row(group: AuthorityRow["group"], more: Partial<AuthorityRow> = {}): AuthorityRow {
  const cap = more.cap ?? null;
  return {
    group,
    label: AUTHORITY_ROW_LABELS[group],
    cap,
    ownAndOthers: false,
    followed: false,
    enforcedOn: null,
    values: cap ? CAPPED_VALUES : ALL_VALUES,
    ...more,
  };
}

/** A few areas of `/role-card-options`' Authority, in the shape the service gives them. */
export const AUTHORITY_AREAS: readonly AuthorityArea[] = [
  {
    label: "Work",
    rows: [
      row("taskRecords", { ownAndOthers: true }),
      row("movingWork"),
      row("gatesAndRuns"),
      row("continueAtGateOnOwnWork", { cap: "trust-anchor" }),
    ],
  },
  {
    label: "People and Roles",
    rows: [row("changeRoles", { cap: "trust-anchor" }), row("memoryAndAvatar")],
  },
  {
    label: null,
    rows: [
      row("runInstalls", {
        followed: true,
        enforcedOn: "run_environment_check",
        values: ["allowed", "consult", "ask-me", "never"],
      }),
      row("publishOutsideThePipeline", {
        followed: true,
        values: ["allowed", "consult", "ask-me", "never"],
      }),
      row("approveHeldCallsAndApplyProposals", { cap: "trust-anchor" }),
    ],
  },
];
