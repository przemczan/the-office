import type { TaskStage } from "@the-office/contracts";
import { Icon } from "@the-office/ui";
import type { ReactNode } from "react";

const STATE_ICONS: Readonly<Partial<Record<TaskStage["state"], string>>> = {
  done: "check",
  failed: "x",
  "waiting-on-you": "pause",
  paused: "pause",
  stopped: "square",
  skipped: "minus",
};

/** A Stage's mark: its kind by the shape, its state by the colour and the icon. */
export function StageMark({
  taskStage: { stage, state },
  small = false,
}: {
  readonly taskStage: TaskStage;
  /** As the Pipeline in small draws it. */
  readonly small?: boolean;
}): ReactNode {
  const icon = STATE_ICONS[state];
  return (
    <span
      className={`stage-mark stage-mark-${state} stage-mark-kind-${stage.kind}${small ? " stage-mark-small" : ""}`}
    >
      {icon && <Icon name={icon} size={small ? 10 : 12} />}
    </span>
  );
}
