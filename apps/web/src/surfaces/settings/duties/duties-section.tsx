import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AuthorityArea, Duty, Role } from "@the-office/contracts";
import { Button, Card, Select } from "@the-office/ui";
import type { ReactNode } from "react";
import {
  changeDuty,
  changeRoleCard,
  dutyQueries,
  roleCardQueries,
  roleQueries,
  DUTIES,
} from "../../../api/people.ts";
import {
  dutyDescription,
  fallbackWords,
  holderName,
  holderOptions,
  letGoHolderWords,
  NOBODY,
  passedOverWords,
} from "../../../shell/duty-words.ts";
import { jobSettingsWords, roleTitlesOf, type RoleTitles } from "../../../shell/role-card-words.ts";
import { usePageHeading } from "../../../shell/page-heading.tsx";
import { useToast } from "../../../shell/toasts.tsx";
import { SettingsCardTitle, SettingsProblem } from "../settings-card-parts.tsx";

/** The Select's value for a duty held by nobody; no Role key is empty. */
const NOBODY_VALUE = "";

/** Settings › Duties: who holds each built-in job, picked from the hired Roles or nobody. */
export function DutiesSection(): ReactNode {
  usePageHeading({ title: "Settings", crumb: "Duties" });
  const duties = useQuery(dutyQueries.list());
  const roles = useQuery(roleQueries.list());
  return (
    <Card title={<SettingsCardTitle icon="briefcase">Duties</SettingsCardTitle>}>
      <p className="settings-note">
        Each duty is done by the person holding it. Duties follow the Role, so renaming a Role
        changes nothing; letting someone go leaves their duties to what happens while nobody holds
        them. A change reaches only what starts after it.
      </p>
      {duties.data && roles.data && (
        <ul className="duty-list">
          {duties.data.map((duty) => (
            <DutyRow key={duty.key} duty={duty} roles={roles.data} />
          ))}
        </ul>
      )}
      <SettingsProblem title="The duties can't be read" error={duties.error ?? roles.error} />
    </Card>
  );
}

function DutyRow({
  duty,
  roles,
}: {
  readonly duty: Duty;
  readonly roles: readonly Role[];
}): ReactNode {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const options = useQuery(roleCardQueries.options());
  /** Who held the duty before the user's last pick here, while that Role is someone else. */
  const [previous, setPrevious] = useState<string | undefined>();
  const saving = useMutation({
    mutationFn: (roleKey: string | null) => changeDuty(duty.key, roleKey),
    onSuccess: (changed) => {
      const before = duty.holder;
      setPrevious(before && before.roleKey !== changed.holder?.roleKey ? before.name : undefined);
      queryClient.setQueryData(dutyQueries.list().queryKey, (listed) =>
        listed?.map((each) => (each.key === changed.key ? changed : each)),
      );
      showToast(`${changed.label}: ${heldWords(changed)}`);
    },
  });
  const notes = [
    letGoHolderWords(duty, roles),
    duty.holder ? undefined : fallbackWords(duty.key),
    passedOverWords(duty, roles),
    previous === undefined ? undefined : `${previous} keeps the authority on their card`,
  ].filter((note) => note !== undefined);
  return (
    <li className="duty-row">
      <div className="duty-row-choice">
        <div className="duty-row-words">
          <b>{duty.label}</b>
          <p className="settings-note">{dutyDescription(duty.key)}</p>
        </div>
        <Select
          aria-label={duty.label}
          value={duty.holder?.roleKey ?? NOBODY_VALUE}
          options={[{ value: NOBODY_VALUE, label: NOBODY }, ...holderOptions(roles)]}
          disabled={saving.isPending}
          onChange={(roleKey) => saving.mutate(roleKey === NOBODY_VALUE ? null : roleKey)}
        />
      </div>
      {notes.map((note) => (
        <p key={note} className="settings-note duty-row-note">
          {note}
        </p>
      ))}
      {duty.holder && options.data && (
        <JobNeeds
          duty={duty}
          holder={duty.holder}
          roles={roles}
          areas={options.data.authority}
          titles={roleTitlesOf(options.data)}
        />
      )}
      <SettingsProblem title={`${duty.label} wasn't changed`} error={saving.error} />
    </li>
  );
}

/** The job's settings the holder's card leaves Never, with the button giving them (spec §2.2). */
function JobNeeds({
  duty,
  holder,
  roles,
  areas,
  titles,
}: {
  readonly duty: Duty;
  readonly holder: NonNullable<Duty["holder"]>;
  readonly roles: readonly Role[];
  readonly areas: readonly AuthorityArea[];
  readonly titles: RoleTitles;
}): ReactNode {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const role = roles.find(({ key }) => key === holder.roleKey);
  const settings = duty.jobSettingsToGive ?? {};
  const giving = useMutation({
    mutationFn: () => {
      if (!role) throw new Error("The Role isn't listed.");
      return changeRoleCard(role.key, {
        ...role.card,
        authority: { ...role.card.authority, ...settings },
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: DUTIES });
      void queryClient.invalidateQueries({ queryKey: ["roles"] });
      showToast(`${holder.name} has the settings ${duty.label} needs.`);
    },
  });
  const needs = jobSettingsWords(settings, areas, titles);
  if (needs.length === 0 || !role) return null;
  return (
    <div className="duty-row-needs">
      <p className="settings-note duty-row-note">This job needs: {needs.join(", ")}</p>
      <Button variant="secondary" loading={giving.isPending} onClick={() => giving.mutate()}>
        Give {holder.name} these settings
      </Button>
      <SettingsProblem title={`${holder.name}'s card wasn't changed`} error={giving.error} />
    </div>
  );
}

function heldWords(duty: Duty): string {
  return duty.holder ? `${holderName(duty)} holds it now.` : "nobody holds it now.";
}
