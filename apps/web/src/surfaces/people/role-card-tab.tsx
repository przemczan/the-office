import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import type { Role, RoleCardOptions, RoleChange } from "@the-office/contracts";
import { Timeline, type TimelineItem } from "@the-office/ui";
import type { ReactNode } from "react";
import { roleCardQueries, roleQueries } from "../../api/people.ts";
import { skillQueries } from "../../api/skills.ts";
import { dayAndClockOf } from "../../shell/time.ts";
import { PersonBlock } from "./role-card-layout.tsx";
import {
  changeLine,
  roleTitlesOf,
  skillsChangeLine,
  type FieldValueNames,
} from "../../shell/role-card-words.ts";
import { useEngineName } from "../../shell/use-engine-name.ts";
import { RoleCardView } from "./role-card-view.tsx";

/** The Role card, read-only, beside its change history. */
export function RoleCardTab(): ReactNode {
  const { roleKey } = useParams({ from: "/people/$roleKey/role" });
  const role = useQuery(roleQueries.one(roleKey));
  const options = useQuery(roleCardQueries.options());
  const library = useQuery(skillQueries.list());
  if (!role.data || !options.data) return null;
  return (
    <div className="person-columns">
      <div className="person-column">
        <PersonBlock icon="id-card" title="Role card">
          <RoleCardView role={role.data} options={options.data} library={library.data ?? []} />
        </PersonBlock>
      </div>
      <div className="person-column">
        <ChangesBlock roleKey={roleKey} options={options.data} />
      </div>
    </div>
  );
}

/** Every change since the hire, with its time; each applies from the next session started. */
function ChangesBlock({
  roleKey,
  options,
}: {
  readonly roleKey: string;
  readonly options: RoleCardOptions;
}): ReactNode {
  const changes = useQuery(roleQueries.changes(roleKey));
  const roles = useQuery(roleQueries.list()).data;
  const names = { roleTitles: roleTitlesOf(options), engineName: useEngineName() };
  return (
    <PersonBlock icon="history" title="Changes">
      {changes.data && (
        <Timeline items={changes.data.map((change) => itemOf(change, names, roles))} />
      )}
      <p className="person-note">Each change applies from the next session started.</p>
    </PersonBlock>
  );
}

function itemOf(
  change: RoleChange,
  names: FieldValueNames,
  roles: readonly Role[] | undefined,
): TimelineItem {
  const time = dayAndClockOf(change.at);
  const id = `${change.kind}-${change.at}`;
  switch (change.kind) {
    case "hired":
      return {
        id,
        icon: "user-plus",
        tone: "success",
        title: "Hired",
        ...(change.proposedBy !== null && {
          description: proposedByLine(change.proposedBy, roles),
        }),
        time,
      };
    case "card-changed":
      return {
        id,
        icon: "pencil",
        title: `Role card version ${change.cardVersion}`,
        description: [
          ...change.changes.map((fieldChange) => changeLine(fieldChange, names)),
          ...(change.proposedBy === null ? [] : [proposedByLine(change.proposedBy, roles)]),
        ].join(" · "),
        time,
      };
    case "skills-changed":
      return { id, icon: "sparkles", title: skillsChangeLine(change), time };
  }
}

/** Who drafted the Proposal the user applied, by name; the Role's key once nobody fills it. */
function proposedByLine(roleKey: string, roles: readonly Role[] | undefined): string {
  const name = roles?.find(({ key }) => key === roleKey)?.card.name ?? roleKey;
  return `proposed by ${name}, applied by you`;
}
