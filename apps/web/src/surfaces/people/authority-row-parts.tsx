import type {
  Authority,
  AuthorityCap,
  AuthorityGroup,
  AuthorityInEffect,
  AuthorityRow,
  AuthoritySetting,
  AuthorityValue,
  RoleCardOptions,
} from "@the-office/contracts";
import { Badge, PlainMark, Select } from "@the-office/ui";
import { useId, type ReactNode } from "react";
import {
  authorityChoiceOf,
  authorityChoices,
  authoritySettingLabel,
  authorityValueOf,
  CAP_REASONS,
  CAPPED_NOTE,
  ENFORCEMENT_LABELS,
  ownAndOthersOf,
  presetDefaultWords,
  sameAuthoritySetting,
  settingOf,
  type RoleTitles,
} from "../../shell/role-card-words.ts";

/**
 * The card's Authority with one row set to `setting`, or dropped when it is left out or stands at
 * the preset's default: the card keeps only the rows the user set.
 */
export function withAuthorityRow(
  authority: Authority,
  group: AuthorityGroup,
  setting: AuthoritySetting | undefined,
  defaults: AuthorityInEffect,
): Authority {
  const rest = Object.fromEntries(Object.entries(authority).filter(([key]) => key !== group));
  return setting === undefined || sameAuthoritySetting(setting, defaults[group])
    ? rest
    : { ...rest, [group]: setting };
}

/** Whether a Consult in the setting names a Role nobody fills, so it asks the user meanwhile. */
export function asksYouUntilHired(
  setting: AuthoritySetting,
  filledRoleKeys: ReadonlySet<string>,
): boolean {
  return ownAndOthersOf(setting).some(
    (value) => value.kind === "consult" && !filledRoleKeys.has(value.role),
  );
}

/** A setting in words: plainly when set, muted as "Preset default (Never)" at the default. */
export function SettingText({
  setting,
  atDefault,
  roleTitles,
}: {
  readonly setting: AuthoritySetting;
  readonly atDefault: boolean;
  readonly roleTitles: RoleTitles;
}): ReactNode {
  const words = authoritySettingLabel(setting, roleTitles);
  return atDefault ? <span className="role-card-muted">{presetDefaultWords(words)}</span> : words;
}

/** "Proposal, Ask me or Never only", naming its reason, whose words show on hover and focus. */
export function CappedNote({ cap }: { readonly cap: AuthorityCap }): ReactNode {
  const reason = CAP_REASONS[cap];
  return (
    <span className="role-card-note">
      {CAPPED_NOTE}:{" "}
      <PlainMark words={reason.words} className="role-card-cap-reason">
        {reason.name}
      </PlainMark>
    </span>
  );
}

/** A followed group's badge, with the Office tool that enforces it all the same. */
export function FollowedMark({ row }: { readonly row: AuthorityRow }): ReactNode {
  return (
    <span className="role-card-authority-followed">
      <Badge size="sm" tone="neutral">
        {ENFORCEMENT_LABELS.followed}
      </Badge>
      {row.enforcedOn && <span className="role-card-note">enforced on {row.enforcedOn}</span>}
    </span>
  );
}

/**
 * The select of a row's values (Own and Others' on a record's row) for the setting it stands at,
 * with the caps and the Roles a Consult may name. With a `subject` (a person, where several share a
 * table) the labels are hidden and name them; `hint` goes under a single select.
 */
export function AuthorityRowSelects({
  row,
  setting,
  consultable,
  disabled,
  subject,
  hint,
  onChange,
}: {
  readonly row: AuthorityRow;
  readonly setting: AuthoritySetting;
  readonly consultable: RoleCardOptions["knownRoles"];
  readonly disabled: boolean;
  readonly subject?: string;
  readonly hint?: string;
  readonly onChange: (setting: AuthoritySetting) => void;
}): ReactNode {
  const [own, others] = ownAndOthersOf(setting);
  const select = (label: string, value: AuthorityValue, pick: (picked: AuthorityValue) => void) => (
    <ValueSelect
      label={label}
      subject={subject}
      hint={row.ownAndOthers ? undefined : hint}
      value={value}
      choices={authorityChoices(row.values, consultable, value)}
      disabled={disabled}
      onPick={pick}
    />
  );
  if (!row.ownAndOthers) return select(row.label, own, (picked) => onChange(picked));
  return (
    <div className="role-card-form-pair">
      {select("Own", own, (picked) => onChange(settingOf(picked, others)))}
      {select("Others'", others, (picked) => onChange(settingOf(own, picked)))}
    </div>
  );
}

function ValueSelect({
  label,
  subject,
  hint,
  value,
  choices,
  disabled,
  onPick,
}: {
  readonly label: string;
  readonly subject: string | undefined;
  readonly hint: string | undefined;
  readonly value: AuthorityValue;
  readonly choices: { value: string; label: string }[];
  readonly disabled: boolean;
  readonly onPick: (picked: AuthorityValue) => void;
}): ReactNode {
  const id = useId();
  const select = (shown: string | undefined) => (
    <Select
      id={id}
      label={shown}
      hint={hint}
      size={subject === undefined ? "md" : "sm"}
      value={authorityChoiceOf(value)}
      options={choices}
      disabled={disabled}
      onChange={(choice) => onPick(authorityValueOf(choice))}
    />
  );
  if (subject === undefined) return select(label);
  return (
    <>
      <label htmlFor={id} className="visually-hidden">
        {`${label}, ${subject}`}
      </label>
      {select(undefined)}
    </>
  );
}
