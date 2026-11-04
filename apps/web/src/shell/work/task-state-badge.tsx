import type { Priority, TaskState } from "@the-office/contracts";
import { Badge, type BadgeProps, Icon } from "@the-office/ui";
import type { ReactNode } from "react";
import { PRIORITY_ICONS, PRIORITY_NAMES, TASK_STATE_TONES, taskStateWords } from "./work-words.ts";

/** The Task's state, a Paused one by what holds it, as `taskStateWords` says. */
export function TaskStateBadge({
  state,
  pausedByAlarm = false,
  stopped = false,
  tone = TASK_STATE_TONES[state],
}: {
  readonly state: TaskState;
  readonly pausedByAlarm?: boolean;
  readonly stopped?: boolean;
  /** Where a page's design draws it otherwise. */
  readonly tone?: NonNullable<BadgeProps["tone"]>;
}): ReactNode {
  return (
    <Badge tone={tone} dot>
      {taskStateWords(state, { pausedByAlarm, stopped })}
    </Badge>
  );
}

/** High and low show by an arrow; normal shows nothing, as most Tasks are. */
export function PriorityIcon({ priority }: { readonly priority: Priority }): ReactNode {
  if (priority === "normal") return null;
  const name = `${PRIORITY_NAMES[priority]} priority`;
  return (
    <span className={`priority-icon priority-${priority}`} title={name}>
      <Icon name={PRIORITY_ICONS[priority]} size={14} />
      <span className="visually-hidden">{name}</span>
    </span>
  );
}
