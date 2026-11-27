import type {
  AuthorityArea,
  AuthorityGroup,
  AuthorityInEffect,
  AuthorityRow,
  AuthoritySetting,
  Role,
  RoleCardOptions,
  SavedRoleCard,
} from "@the-office/contracts";
import { Button } from "@the-office/ui";
import type { ReactNode } from "react";
import {
  asksYouUntilHired,
  AuthorityRowSelects,
  CappedNote,
  FollowedMark,
  SettingText,
  withAuthorityRow,
} from "./authority-row-parts.tsx";
import { FixedForTheCaretaker, RoleCardGroup } from "./role-card-layout.tsx";
import {
  areaSetting,
  ASKS_YOU_UNTIL_HIRED,
  authorityInEffect,
  authoritySettingLabel,
  followedWords,
  presetDefaultWords,
  roleTitlesOf,
  sameAuthoritySetting,
  type RoleTitles,
} from "../../shell/role-card-words.ts";

/**
 * The Role card's Authority (People › Role card tab): one row per tool area with the value most of
 * its groups share; inside it, the groups that differ or are capped; then the followed groups and
 * the approvals row. A value at the preset's default is muted, "Preset default (Ask me)".
 */
export function AuthorityView({
  role,
  options,
}: {
  readonly role: Role;
  readonly options: RoleCardOptions;
}): ReactNode {
  const roleTitles = roleTitlesOf(options);
  const inEffect = authorityInEffect(role.presetAuthority, role.card.authority);
  // The Caretaker's Authority is fixed rather than a preset's, so it reads plainly.
  const atDefault = (group: AuthorityGroup): boolean =>
    !role.builtIn && role.card.authority[group] === undefined;
  const asksYou = (group: AuthorityGroup): boolean => role.askingYouUntilHired.includes(group);
  const rowLine = (row: AuthorityRow, className?: string): ReactNode => (
    <li key={row.group} className={className}>
      <span className="role-card-switch-name">{row.label}</span>
      <span className="role-card-authority-value">
        <SettingText
          setting={inEffect[row.group]}
          atDefault={atDefault(row.group)}
          roleTitles={roleTitles}
        />
        {asksYou(row.group) && <span className="role-card-note">{ASKS_YOU_UNTIL_HIRED}</span>}
        {row.cap && <CappedNote cap={row.cap} />}
        {row.followed && <FollowedMark row={row} />}
      </span>
    </li>
  );
  return (
    <RoleCardGroup group="authority">
      {options.authority.map((area) => {
        if (area.label === null) {
          return (
            <ul key="outside-areas" className="role-card-authority">
              {area.rows.map((row) => rowLine(row))}
            </ul>
          );
        }
        const value = areaSetting(area, inEffect);
        if (!value) return null;
        const sharing = area.rows.filter(({ group }) =>
          sameAuthoritySetting(inEffect[group], value),
        );
        const inside = area.rows.filter(
          ({ group, cap }) => cap !== null || !sameAuthoritySetting(inEffect[group], value),
        );
        return (
          <ul key={area.label} className="role-card-authority" aria-label={area.label}>
            <li className="role-card-authority-area">
              <span className="role-card-authority-area-name">{area.label}</span>
              <span className="role-card-authority-value">
                <SettingText
                  setting={value}
                  atDefault={sharing.every(({ group }) => atDefault(group))}
                  roleTitles={roleTitles}
                />
                {sharing.some(({ group }) => asksYou(group)) && (
                  <span className="role-card-note">{ASKS_YOU_UNTIL_HIRED}</span>
                )}
              </span>
            </li>
            {inside.map((row) => rowLine(row, "role-card-authority-inside"))}
          </ul>
        );
      })}
      {role.builtIn && <FixedForTheCaretaker />}
    </RoleCardGroup>
  );
}

/**
 * The form's Authority: every row under its area's heading, each a select of the values it takes
 * (Own and Others' for a record's row), its preset's default muted or Reset beside it. Choosing the
 * default puts the row back at it, as the service keeps it.
 */
export function AuthorityFields({
  draft,
  defaults,
  options,
  ownRoleKey,
  hiredRoles,
  fixed,
  change,
}: {
  readonly draft: SavedRoleCard;
  /** What each row stands at when the card leaves it out. */
  readonly defaults: AuthorityInEffect;
  readonly options: RoleCardOptions;
  /** Undefined while the Role is yet to be hired. */
  readonly ownRoleKey: string | undefined;
  readonly hiredRoles: ReadonlySet<string>;
  readonly fixed: boolean;
  change(fields: Partial<SavedRoleCard>): void;
}): ReactNode {
  const roleTitles = roleTitlesOf(options);
  const consultable = options.knownRoles.filter(({ key }) => key !== ownRoleKey);
  const setRow = (group: AuthorityGroup, setting: AuthoritySetting | undefined): void =>
    change({ authority: withAuthorityRow(draft.authority, group, setting, defaults) });
  return (
    <RoleCardGroup group="authority">
      {options.authority.map((area) => (
        <AreaFields key={area.label ?? "outside-areas"} area={area}>
          {area.rows.map((row) => (
            <AuthorityRowField
              key={row.group}
              row={row}
              setting={draft.authority[row.group]}
              defaultSetting={defaults[row.group]}
              consultable={consultable}
              hiredRoles={hiredRoles}
              roleTitles={roleTitles}
              fixed={fixed}
              onChange={(setting) => setRow(row.group, setting)}
            />
          ))}
        </AreaFields>
      ))}
      {fixed && <FixedForTheCaretaker />}
    </RoleCardGroup>
  );
}

function AreaFields({
  area,
  children,
}: {
  readonly area: AuthorityArea;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <div className="role-card-authority-fields" role="group" aria-label={area.label ?? undefined}>
      {area.label && <h4 className="role-card-authority-area-title">{area.label}</h4>}
      {children}
    </div>
  );
}

function AuthorityRowField({
  row,
  setting,
  defaultSetting,
  consultable,
  hiredRoles,
  roleTitles,
  fixed,
  onChange,
}: {
  readonly row: AuthorityRow;
  /** Undefined at the preset's default. */
  readonly setting: AuthoritySetting | undefined;
  readonly defaultSetting: AuthoritySetting;
  readonly consultable: RoleCardOptions["knownRoles"];
  readonly hiredRoles: ReadonlySet<string>;
  readonly roleTitles: RoleTitles;
  readonly fixed: boolean;
  readonly onChange: (setting: AuthoritySetting | undefined) => void;
}): ReactNode {
  const hint = rowHint(row, asksYouUntilHired(setting ?? defaultSetting, hiredRoles));
  const selects = (
    <AuthorityRowSelects
      row={row}
      setting={setting ?? defaultSetting}
      consultable={consultable}
      disabled={fixed}
      hint={hint}
      onChange={onChange}
    />
  );
  const status = fixed ? null : setting === undefined ? (
    <span className="role-card-muted">
      {presetDefaultWords(authoritySettingLabel(defaultSetting, roleTitles))}
    </span>
  ) : (
    <Button type="button" size="sm" variant="ghost" onClick={() => onChange(undefined)}>
      Reset to the preset's default
    </Button>
  );
  if (!row.ownAndOthers) {
    return (
      <div className="role-card-authority-field">
        {selects}
        <AuthorityRowStatus row={row}>{status}</AuthorityRowStatus>
      </div>
    );
  }
  return (
    <div className="role-card-authority-field" role="group" aria-label={row.label}>
      <span className="role-card-authority-row-name">{row.label}</span>
      {selects}
      {hint && <span className="role-card-note">{hint}</span>}
      <AuthorityRowStatus row={row}>{status}</AuthorityRowStatus>
    </div>
  );
}

function AuthorityRowStatus({
  row,
  children,
}: {
  readonly row: AuthorityRow;
  readonly children: ReactNode;
}): ReactNode {
  if (!children && !row.cap) return null;
  return (
    <div className="role-card-authority-status">
      {children}
      {row.cap && <CappedNote cap={row.cap} />}
    </div>
  );
}

/**
 * The row's hint: "Followed by the Agent" on a followed group, with what enforces it, and that a
 * Consult of a Role nobody fills asks the user meanwhile.
 */
function rowHint(row: AuthorityRow, asksYou: boolean): string | undefined {
  const parts = [
    ...(row.followed ? [followedWords(row)] : []),
    ...(asksYou ? [ASKS_YOU_UNTIL_HIRED] : []),
  ];
  return parts.length > 0 ? `${parts.join(". ")}.` : undefined;
}
