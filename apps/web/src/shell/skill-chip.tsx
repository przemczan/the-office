import { Icon } from "@the-office/ui";
import type { ReactNode } from "react";

/** A skill's name as every surface shows it, in mono beside the sparkle. */
export function SkillChip({
  name,
  title,
}: {
  readonly name: string;
  /** Shown on hover, such as its description. */
  readonly title?: string;
}): ReactNode {
  return (
    <span className="skill-chip" title={title}>
      <Icon name="sparkle" size={12} strokeWidth={1.6} />
      {name}
    </span>
  );
}
