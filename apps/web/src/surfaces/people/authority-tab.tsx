import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useBlocker } from "@tanstack/react-router";
import type {
  AuthorityGroup,
  AuthorityRow,
  AuthoritySetting,
  Role,
  RoleCardOptions,
} from "@the-office/contracts";
import { Alert, Button, Dialog, Switch } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { changeRoleCard, filledRoleKeys, roleCardQueries, roleQueries } from "../../api/people.ts";
import { usePageHeading } from "../../shell/page-heading.tsx";
import { PersonAvatar } from "../../shell/person-avatar.tsx";
import {
  ASKS_YOU_UNTIL_HIRED,
  roleTitlesOf,
  type RoleTitles,
} from "../../shell/role-card-words.ts";
import { useToast } from "../../shell/toasts.tsx";
import {
  asksYouUntilHired,
  AuthorityRowSelects,
  CappedNote,
  FollowedMark,
  SettingText,
  withAuthorityRow,
} from "./authority-row-parts.tsx";
import {
  areasWhereTheyDiffer,
  atPresetDefault,
  authorityColumns,
  authorityOf,
  changedCards,
  isChanged,
  settingInEffect,
  valueCounts,
  valueCountWords,
  type AuthorityEdits,
} from "./authority-table.ts";
import { PeopleTabs } from "./people-tabs.tsx";
import "./people.css";

/** People › Authority: every Authority row against every person, to compare and change at once. */
export function AuthorityTab(): ReactNode {
  const roles = useQuery(roleQueries.list());
  const options = useQuery(roleCardQueries.options());
  const [onlyDiffering, setOnlyDiffering] = useState(false);
  usePageHeading({ title: "People", crumb: "Authority" });
  const error = roles.error ?? options.error;
  return (
    <div className="people-page">
      <PeopleTabs />
      {error && <Alert tone="danger" title={error.message} />}
      {roles.data && options.data && (
        <AuthorityTable
          roles={roles.data}
          options={options.data}
          onlyDiffering={onlyDiffering}
          onOnlyDifferingChange={setOnlyDiffering}
        />
      )}
    </div>
  );
}

interface NotSaved {
  readonly name: string;
  readonly reason: string;
}

function AuthorityTable({
  roles,
  options,
  onlyDiffering,
  onOnlyDifferingChange,
}: {
  readonly roles: readonly Role[];
  readonly options: RoleCardOptions;
  readonly onlyDiffering: boolean;
  readonly onOnlyDifferingChange: (on: boolean) => void;
}): ReactNode {
  const people = authorityColumns(roles);
  const roleTitles = roleTitlesOf(options);
  const filled = filledRoleKeys(roles);
  const queryClient = useQueryClient();
  const showToast = useToast();
  // Whose cells are selects: everyone but the Caretaker while editing; a saved person leaves.
  const [editing, setEditing] = useState<ReadonlySet<string>>(new Set());
  const [edits, setEdits] = useState<AuthorityEdits>(new Map());
  const [notSaved, setNotSaved] = useState<readonly NotSaved[]>([]);
  const changed = changedCards(people, edits);
  const unsaved = editing.size > 0 && changed.length > 0;
  const blocker = useBlocker({
    shouldBlockFn: () => unsaved,
    enableBeforeUnload: unsaved,
    disabled: !unsaved,
    withResolver: true,
  });
  const stopEditing = (): void => {
    setEditing(new Set());
    setEdits(new Map());
    setNotSaved([]);
  };
  const saving = useMutation({
    mutationFn: async (): Promise<void> => {
      const results = await Promise.allSettled(
        changed.map(({ role, card }) => changeRoleCard(role.key, card)),
      );
      const saved = new Set<string>();
      const refused: NotSaved[] = [];
      results.forEach((result, index) => {
        const { role } = changed[index] as (typeof changed)[number];
        if (result.status === "fulfilled") saved.add(role.key);
        else
          refused.push({
            name: role.card.name,
            reason: result.reason instanceof Error ? result.reason.message : String(result.reason),
          });
      });
      await queryClient.invalidateQueries(roleQueries.list());
      setEditing((now) => new Set([...now].filter((key) => !saved.has(key))));
      setEdits((now) => new Map([...now].filter(([key]) => !saved.has(key))));
      setNotSaved(refused);
      if (saved.size > 0) {
        showToast(
          `Authority saved for ${saved.size === 1 ? "1 person" : `${saved.size} people`}. It applies from the next session.`,
        );
      }
      if (refused.length === 0) stopEditing();
    },
  });
  const areas = onlyDiffering
    ? areasWhereTheyDiffer(options.authority, people, edits)
    : options.authority;
  const edit = (role: Role, group: AuthorityGroup, setting: AuthoritySetting | undefined): void => {
    const next = new Map(edits);
    next.set(
      role.key,
      withAuthorityRow(authorityOf(role, edits), group, setting, role.presetAuthority),
    );
    setEdits(next);
  };
  return (
    <>
      <div className="authority-toolbar">
        <Switch
          label="Only rows where people differ"
          checked={onlyDiffering}
          onChange={onOnlyDifferingChange}
        />
        {editing.size === 0 && (
          <Button
            variant="secondary"
            onClick={() =>
              setEditing(new Set(people.filter(({ builtIn }) => !builtIn).map(({ key }) => key)))
            }
          >
            Edit Authority
          </Button>
        )}
      </div>
      {notSaved.length > 0 && (
        <Alert tone="danger" title={`Not saved: ${notSaved.map(({ name }) => name).join(", ")}`}>
          <ul className="refusal-reasons">
            {notSaved.map(({ name, reason }) => (
              <li key={name}>
                {name}: {reason}
              </li>
            ))}
          </ul>
        </Alert>
      )}
      <div className="authority-table-scroll">
        <table className="authority-table">
          <thead>
            <tr>
              <th scope="col" className="authority-row-head">
                Authority
              </th>
              {people.map((role) => (
                <PersonHead key={role.key} role={role} />
              ))}
              <th scope="col">People</th>
            </tr>
          </thead>
          <tbody>
            {areas.map((area) => (
              <AreaRows
                key={area.label ?? "outside-areas"}
                columns={people.length + 2}
                label={area.label}
              >
                {area.rows.map((row) => (
                  <tr key={row.group}>
                    <th scope="row" className="authority-row-head">
                      <RowName row={row} />
                    </th>
                    {people.map((role) => (
                      <td
                        key={role.key}
                        className={
                          isChanged(role, row.group, edits)
                            ? "authority-cell authority-cell-changed"
                            : "authority-cell"
                        }
                      >
                        <Cell
                          role={role}
                          row={row}
                          edits={edits}
                          editing={editing.has(role.key)}
                          options={options}
                          roleTitles={roleTitles}
                          filled={filled}
                          onChange={(setting) => edit(role, row.group, setting)}
                        />
                      </td>
                    ))}
                    <td className="authority-counts">
                      {valueCountWords(valueCounts(people, row.group, edits), roleTitles)}
                    </td>
                  </tr>
                ))}
              </AreaRows>
            ))}
          </tbody>
        </table>
      </div>
      {editing.size > 0 && (
        <div className="role-card-save-bar">
          <span className="role-card-save-bar-text">
            {unsaved ? "You have unsaved changes." : "Change a cell to save it."}
          </span>
          {/* The bar is inverse, as the design system's unsaved-changes bar. */}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            style={{ color: "var(--fg-inverse)" }}
            onClick={stopEditing}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            variant="accent"
            disabled={!unsaved}
            loading={saving.isPending}
            onClick={() => saving.mutate()}
          >
            Save changes
          </Button>
        </div>
      )}
      {blocker.status === "blocked" && (
        <Dialog
          size="small"
          title="Leave without saving?"
          onClose={blocker.reset}
          actions={
            <Button variant="danger" onClick={blocker.proceed}>
              Leave
            </Button>
          }
        >
          <p className="dialog-text">You have unsaved changes to people's Authority.</p>
        </Dialog>
      )}
    </>
  );
}

function PersonHead({ role }: { readonly role: Role }): ReactNode {
  return (
    <th scope="col" className="authority-person-head">
      <Link
        to="/people/$roleKey/role"
        params={{ roleKey: role.key }}
        className="authority-person-link"
      >
        <PersonAvatar roleKey={role.key} name={role.card.name} size="sm" />
        {role.card.name}
      </Link>
      {role.builtIn && <span className="role-card-note">Built in</span>}
    </th>
  );
}

function AreaRows({
  label,
  columns,
  children,
}: {
  readonly label: string | null;
  readonly columns: number;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <>
      {label && (
        <tr className="authority-area">
          <th colSpan={columns} scope="colgroup">
            {label}
          </th>
        </tr>
      )}
      {children}
    </>
  );
}

function RowName({ row }: { readonly row: AuthorityRow }): ReactNode {
  return (
    <>
      <span className="authority-row-name">{row.label}</span>
      {row.cap && <CappedNote cap={row.cap} />}
      {row.followed && <FollowedMark row={row} />}
    </>
  );
}

function Cell({
  role,
  row,
  edits,
  editing,
  options,
  roleTitles,
  filled,
  onChange,
}: {
  readonly role: Role;
  readonly row: AuthorityRow;
  readonly edits: AuthorityEdits;
  readonly editing: boolean;
  readonly options: RoleCardOptions;
  readonly roleTitles: RoleTitles;
  readonly filled: ReadonlySet<string>;
  readonly onChange: (setting: AuthoritySetting | undefined) => void;
}): ReactNode {
  const setting = settingInEffect(role, row.group, edits);
  const atDefault = atPresetDefault(role, row.group, edits);
  const asksYou = asksYouUntilHired(setting, filled);
  return (
    <>
      {editing ? (
        <AuthorityRowSelects
          row={row}
          setting={setting}
          consultable={options.knownRoles.filter(({ key }) => key !== role.key)}
          disabled={false}
          subject={role.card.name}
          onChange={onChange}
        />
      ) : (
        <SettingText setting={setting} atDefault={atDefault} roleTitles={roleTitles} />
      )}
      {asksYou && <span className="role-card-note">{ASKS_YOU_UNTIL_HIRED}</span>}
    </>
  );
}
