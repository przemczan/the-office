import type { Priority, TaskState } from "@the-office/contracts";
import { Badge, Icon } from "@the-office/ui";
import type { ReactNode } from "react";
import {
  PRIORITY_ICONS,
  PRIORITY_NAMES,
  TASK_STATE_NAMES,
  TASK_STATE_TONES,
} from "./work-words.ts";

export function TaskStateBadge({ state }: { readonly state: TaskState }): ReactNode {
  return (
    <Badge tone={TASK_STATE_TONES[state]} dot>
      {TASK_STATE_NAMES[state]}
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
