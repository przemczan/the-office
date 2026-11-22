import { useQuery } from "@tanstack/react-query";
import type { CurrentStage } from "@the-office/contracts";
import { Tooltip } from "@the-office/ui";
import type { ReactNode } from "react";
import { threadQueries } from "../../api/conversations.ts";
import { nowQueries } from "../../api/notifications.ts";
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

/** A started Task's current Stage, from `GET /now`; undefined before its first Stage run. */
export function useCurrentStage(): (taskId: string) => CurrentStage | undefined {
  const { data: now } = useQuery(nowQueries.now());
  return (taskId) => now?.running.find((task) => task.taskId === taskId)?.stage ?? undefined;
}

/**
 * Who is working on the Task now and the Stage it is at: the Stage's name as a short label (cut with
 * an ellipsis when the row is narrow), then, while someone works, the live dot and their avatars.
 * On hover, the names with the Stage's name while someone works, else the current Stage alone.
 */
export function WorkingMark({
  people,
  stageName,
}: {
  readonly people: readonly PersonWorking[];
  readonly stageName?: string | undefined;
}): ReactNode {
  const names = people.map(({ name }) => name).join(", ");
  const working = people.length > 0;
  const words = working
    ? `Working now: ${stageName ? `${names} · ${stageName}` : names}`
    : `Current Stage: ${stageName ?? ""}`;
  const others = people.length - AVATARS_SHOWN;
  return (
    <Tooltip content={words}>
      <span
        className={stageName ? "working-mark working-mark-with-stage" : "working-mark"}
        role="img"
        aria-label={words}
      >
        {stageName && (
          <span className="working-mark-stage" aria-hidden="true">
            {stageName}
          </span>
        )}
        {working && (
          <>
            <span className="live-dot" />
            <span className="working-mark-avatars">
              {people.slice(0, AVATARS_SHOWN).map(({ roleKey, name }) => (
                <PersonAvatar key={roleKey} roleKey={roleKey} name={name} size="xs" />
              ))}
            </span>
          </>
        )}
        {others > 0 && <span className="working-mark-others">+{others}</span>}
      </span>
    </Tooltip>
  );
}
