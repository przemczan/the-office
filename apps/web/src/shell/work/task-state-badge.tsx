import type { Priority, TaskState } from "@the-office/contracts";
import { Badge, type BadgeProps, Icon, PlainMark } from "@the-office/ui";
import type { ReactNode } from "react";
import {
  PRIORITY_ICONS,
  PRIORITY_NAMES,
  TASK_STATE_TONES,
  taskStateWords,
  type PausedHold,
} from "./work-words.ts";

/** The Task's state, a Paused one by what holds it, as `taskStateWords` says. */
export function TaskStateBadge({
  state,
  pausedBy = null,
  resumesAt = null,
  stopped = false,
  tone = TASK_STATE_TONES[state],
}: PausedHold & {
  readonly state: TaskState;
  readonly stopped?: boolean;
  /** Where a page's design draws it otherwise. */
  readonly tone?: NonNullable<BadgeProps["tone"]>;
}): ReactNode {
  return (
    <Badge tone={tone} dot>
      {taskStateWords(state, { pausedBy, resumesAt, stopped })}
    </Badge>
  );
}

/** The priority's own icon in its colour, named on hover. */
export function PriorityIcon({ priority }: { readonly priority: Priority }): ReactNode {
  const name = `${PRIORITY_NAMES[priority]} priority`;
  return (
    <PlainMark words={name} className={`priority-icon priority-${priority}`}>
      <Icon name={PRIORITY_ICONS[priority]} size={14} />
      <span className="visually-hidden">{name}</span>
    </PlainMark>
  );
}

/** The priority's icon in its colour alone, where words beside it name it, as a menu's item does. */
export function PriorityGlyph({
  priority,
  size,
}: {
  readonly priority: Priority;
  readonly size: number;
}): ReactNode {
  return (
    <span className={`priority-icon priority-${priority}`} aria-hidden="true">
      <Icon name={PRIORITY_ICONS[priority]} size={size} />
    </span>
  );
}
