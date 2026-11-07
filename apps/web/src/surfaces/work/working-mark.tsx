import { useQuery } from "@tanstack/react-query";
import { Avatar, Tooltip } from "@the-office/ui";
import type { ReactNode } from "react";
import { threadQueries } from "../../api/conversations.ts";
import { roleQueries } from "../../api/people.ts";

const AVATARS_SHOWN = 3;

/** The names of the people working on a Task now; someone no longer hired is left out. */
export function usePeopleWorking(): (taskId: string) => readonly string[] {
  const { data: working } = useQuery(threadQueries.peopleWorking());
  const { data: roles } = useQuery(roleQueries.list());
  return (taskId) => {
    const roleKeys = working?.find((task) => task.taskId === taskId)?.roleKeys ?? [];
    return roleKeys.flatMap(
      (roleKey) => roles?.find(({ key }) => key === roleKey)?.card.name ?? [],
    );
  };
}

/** Who is working on the Task now: their avatars with the live dot, the names on hover. */
export function WorkingMark({ names }: { readonly names: readonly string[] }): ReactNode {
  const words = `Working now: ${names.join(", ")}`;
  const others = names.length - AVATARS_SHOWN;
  return (
    <Tooltip content={words}>
      <span className="working-mark" role="img" aria-label={words}>
        <span className="live-dot" />
        <span className="working-mark-avatars">
          {names.slice(0, AVATARS_SHOWN).map((name) => (
            <Avatar key={name} name={name} size="xs" />
          ))}
        </span>
        {others > 0 && <span className="working-mark-others">+{others}</span>}
      </span>
    </Tooltip>
  );
}
