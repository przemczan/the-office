import type {
  Authority,
  AuthorityArea,
  AuthorityGroup,
  AuthorityRow,
  AuthoritySetting,
  Role,
} from "@the-office/contracts";
import {
  authorityInEffect,
  authoritySettingLabel,
  sameAuthoritySetting,
  type RoleTitles,
} from "../../shell/role-card-words.ts";
import { inGridOrder } from "./people-order.ts";

/** What the user changed in edit mode: each changed person's Authority as it would be saved. */
export type AuthorityEdits = ReadonlyMap<string, Authority>;

/** The people the table has a column for: everyone not let go, the Caretaker first. */
export function authorityColumns(roles: readonly Role[]): Role[] {
  return inGridOrder(roles.filter(({ letGoAt }) => letGoAt === null));
}

/** The Authority a person would have: their card's, or the edit made to it. */
export function authorityOf(role: Role, edits: AuthorityEdits): Authority {
  return edits.get(role.key) ?? role.card.authority;
}

/** What a row stands at for the person, with the edit made to it if any. */
export function settingInEffect(
  role: Role,
  group: AuthorityGroup,
  edits: AuthorityEdits,
): AuthoritySetting {
  return authorityInEffect(role.presetAuthority, authorityOf(role, edits))[group];
}

/** Whether the row stands at the preset's default; never for the Caretaker, whose Authority is fixed. */
export function atPresetDefault(role: Role, group: AuthorityGroup, edits: AuthorityEdits): boolean {
  return !role.builtIn && authorityOf(role, edits)[group] === undefined;
}

/** Whether the edits changed the person's setting on a row. */
export function isChanged(role: Role, group: AuthorityGroup, edits: AuthorityEdits): boolean {
  const edited = edits.get(role.key)?.[group];
  const saved = role.card.authority[group];
  return edited === undefined || saved === undefined
    ? edited !== saved
    : !sameAuthoritySetting(edited, saved);
}

export interface ValueCount {
  readonly setting: AuthoritySetting;
  readonly count: number;
}

/** How many people have each value on a row, the most common first (a tie in the order met). */
export function valueCounts(
  roles: readonly Role[],
  group: AuthorityGroup,
  edits: AuthorityEdits,
): ValueCount[] {
  const counts: { setting: AuthoritySetting; count: number }[] = [];
  for (const role of roles) {
    const setting = settingInEffect(role, group, edits);
    const found = counts.find((each) => sameAuthoritySetting(each.setting, setting));
    if (found) found.count += 1;
    else counts.push({ setting, count: 1 });
  }
  return counts.toSorted((one, other) => other.count - one.count);
}

/** "Allowed 3 · Ask me 2 · Never 1". */
export function valueCountWords(counts: readonly ValueCount[], roleTitles: RoleTitles): string {
  return counts
    .map(({ setting, count }) => `${authoritySettingLabel(setting, roleTitles)} ${count}`)
    .join(" · ");
}

/** The areas keeping only the rows on which the people don't all have the same value. */
export function areasWhereTheyDiffer(
  areas: readonly AuthorityArea[],
  roles: readonly Role[],
  edits: AuthorityEdits,
): AuthorityArea[] {
  const differs = ({ group }: AuthorityRow): boolean => valueCounts(roles, group, edits).length > 1;
  return areas
    .map((area) => ({ ...area, rows: area.rows.filter(differs) }))
    .filter(({ rows }) => rows.length > 0);
}

/** The people whose Authority the edits changed, with the card each would be saved with. */
export function changedCards(
  roles: readonly Role[],
  edits: AuthorityEdits,
): { readonly role: Role; readonly card: Role["card"] }[] {
  return roles.flatMap((role) => {
    const authority = edits.get(role.key);
    return authority && !sameAuthority(authority, role.card.authority)
      ? [{ role, card: { ...role.card, authority } }]
      : [];
  });
}

function sameAuthority(first: Authority, second: Authority): boolean {
  const groups = new Set([...Object.keys(first), ...Object.keys(second)] as AuthorityGroup[]);
  return [...groups].every((group) => {
    const one = first[group];
    const other = second[group];
    return one === undefined || other === undefined
      ? one === other
      : sameAuthoritySetting(one, other);
  });
}
