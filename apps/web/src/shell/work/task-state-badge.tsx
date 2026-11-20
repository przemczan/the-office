import type { Priority, TaskKind, TaskState } from "@the-office/contracts";
import { Badge, type BadgeProps, Icon, PlainMark } from "@the-office/ui";
import type { ReactNode } from "react";
import {
  KIND_ICONS,
  KIND_NAMES,
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

/**
 * The Kind's mark, as a card shows it after its Project's: its icon in a small box, Bug's tinted,
 * named on hover.
 */
export function KindMark({ kind }: { readonly kind: TaskKind }): ReactNode {
  return (
    <PlainMark words={KIND_NAMES[kind]} className={`kind-mark kind-${kind}`}>
      <Icon name={KIND_ICONS[kind]} size={13} />
    </PlainMark>
  );
}

/** The Kind's icon alone, Bug's in its colour, where words beside it name it. */
export function KindGlyph({
  kind,
  size,
}: {
  readonly kind: TaskKind;
  readonly size: number;
}): ReactNode {
  return (
    <span className={`kind-icon kind-${kind}`} aria-hidden="true">
      <Icon name={KIND_ICONS[kind]} size={size} />
    </span>
  );
}
