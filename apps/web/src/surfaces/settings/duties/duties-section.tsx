import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Duty, Role } from "@the-office/contracts";
import { Card, Select } from "@the-office/ui";
import type { ReactNode } from "react";
import { changeDuty, dutyQueries, roleQueries } from "../../../api/people.ts";
import {
  dutyDescription,
  fallbackWords,
  holderName,
  holderOptions,
  letGoHolderWords,
  NOBODY,
  passedOverWords,
} from "../../../shell/duty-words.ts";
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
  const saving = useMutation({
    mutationFn: (roleKey: string | null) => changeDuty(duty.key, roleKey),
    onSuccess: (changed) => {
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
      <SettingsProblem title={`${duty.label} wasn't changed`} error={saving.error} />
    </li>
  );
}

function heldWords(duty: Duty): string {
  return duty.holder ? `${holderName(duty)} holds it now.` : "nobody holds it now.";
}
