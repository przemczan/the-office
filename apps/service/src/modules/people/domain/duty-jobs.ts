import {
  authorityInEffect,
  authorityProblems,
  keptSetting,
  sameAuthoritySetting,
  type Authority,
  type AuthorityGroup,
  type AuthoritySetting,
  type AuthorityValue,
} from "./authority.js";
import { dutyFor, type DutyKey } from "./duties.js";
import { CARETAKER } from "./known-roles.js";

/** How free a value leaves the person: Never, then Ask me, Consult and Proposal alike, then Allowed. */
function freedom(value: AuthorityValue): number {
  switch (value.kind) {
    case "never":
      return 0;
    case "allowed":
      return 2;
    default:
      return 1;
  }
}

/** Whether `value` leaves the person freer than `than` does: Allowed over the rest, the rest over Never. */
export function moreFree(value: AuthorityValue, than: AuthorityValue): boolean {
  return freedom(value) > freedom(than);
}

function sides(setting: AuthoritySetting): readonly [AuthorityValue, AuthorityValue] {
  return setting.kind === "own-and-others" ? [setting.own, setting.others] : [setting, setting];
}

function pairOf(own: AuthorityValue, others: AuthorityValue): AuthoritySetting {
  return keptSetting({ kind: "own-and-others", own, others });
}

/**
 * The job settings of the duties together, each row at the freest of its duties' settings (own and
 * others' values apart). A row two duties name alike stands at that one.
 */
export function jobSettingsOf(duties: Iterable<DutyKey>): Authority {
  const merged: Partial<Record<AuthorityGroup, AuthoritySetting>> = {};
  for (const duty of duties) {
    for (const [key, setting] of Object.entries(dutyFor(duty).jobSettings)) {
      const group = key as AuthorityGroup;
      const [ownNow, othersNow] = sides(merged[group] ?? setting);
      const [own, others] = sides(setting);
      merged[group] = pairOf(
        moreFree(own, ownNow) ? own : ownNow,
        moreFree(others, othersNow) ? others : othersNow,
      );
    }
  }
  return merged;
}

/**
 * What a row stands at once its Never sides take the job's: a side the card left freer than Never
 * stays as it is, so a job only gives back what the card shut out, never loosens a setting the
 * user or the preset chose.
 */
export function liftedFromNever(card: AuthoritySetting, job: AuthoritySetting): AuthoritySetting {
  const [cardOwn, cardOthers] = sides(card);
  const [jobOwn, jobOthers] = sides(job);
  return pairOf(
    cardOwn.kind === "never" ? jobOwn : cardOwn,
    cardOthers.kind === "never" ? jobOthers : cardOthers,
  );
}

/**
 * The rows of the duty's job a Role's card doesn't give: each row the card's Authority in effect
 * (its set rows over its preset's defaults) leaves Never where the job needs it, at the setting the
 * row would stand at then. Nothing for the Caretaker, whose Authority is fixed, and never a value a
 * row can't take. Empty once the card gives the whole job: giving it twice changes nothing.
 */
export function jobSettingsMissingOn(
  roleKey: string,
  cardAuthority: Authority,
  duty: DutyKey,
): Authority {
  return jobSettingsOfDutiesMissingOn(roleKey, cardAuthority, [duty]);
}

/** As `jobSettingsMissingOn`, for the jobs of all the `duties` a Role holds together. */
export function jobSettingsOfDutiesMissingOn(
  roleKey: string,
  cardAuthority: Authority,
  duties: Iterable<DutyKey>,
): Authority {
  if (roleKey === CARETAKER) return {};
  const inEffect = authorityInEffect(roleKey, cardAuthority);
  const missing: Partial<Record<AuthorityGroup, AuthoritySetting>> = {};
  for (const [key, job] of Object.entries(jobSettingsOf(duties))) {
    const group = key as AuthorityGroup;
    const lifted = liftedFromNever(inEffect[group], job);
    if (sameAuthoritySetting(lifted, inEffect[group])) continue;
    // A row that can't take the job's value stays as it is.
    if (authorityProblems(roleKey, { [group]: lifted }, new Set()).length > 0) continue;
    missing[group] = lifted;
  }
  return missing;
}
