import { useQuery } from "@tanstack/react-query";
import { Tooltip } from "@the-office/ui";
import type { ReactNode } from "react";
import { threadQueries } from "../../api/conversations.ts";
import { roleQueries } from "../../api/people.ts";
import { PersonAvatar } from "../../shell/person-avatar.tsx";

const AVATARS_SHOWN = 3;

/** Someone working on a Task now. */
export interface PersonWorking {
  readonly roleKey: string;
  readonly name: string;
}

/** The people working on a Task now; someone no longer hired is left out. */
export function usePeopleWorking(): (taskId: string) => readonly PersonWorking[] {
  const { data: working } = useQuery(threadQueries.peopleWorking());
  const { data: roles } = useQuery(roleQueries.list());
  return (taskId) => {
    const roleKeys = working?.find((task) => task.taskId === taskId)?.roleKeys ?? [];
    return roleKeys.flatMap((roleKey) => {
      const role = roles?.find(({ key }) => key === roleKey);
      return role ? [{ roleKey, name: role.card.name }] : [];
    });
  };
}

/** Who is working on the Task now: their avatars with the live dot, the names on hover. */
export function WorkingMark({ people }: { readonly people: readonly PersonWorking[] }): ReactNode {
  const words = `Working now: ${people.map(({ name }) => name).join(", ")}`;
  const others = people.length - AVATARS_SHOWN;
  return (
    <Tooltip content={words}>
      <span className="working-mark" role="img" aria-label={words}>
        <span className="live-dot" />
        <span className="working-mark-avatars">
          {people.slice(0, AVATARS_SHOWN).map(({ roleKey, name }) => (
            <PersonAvatar key={roleKey} roleKey={roleKey} name={name} size="xs" />
          ))}
        </span>
        {others > 0 && <span className="working-mark-others">+{others}</span>}
      </span>
    </Tooltip>
  );
}
