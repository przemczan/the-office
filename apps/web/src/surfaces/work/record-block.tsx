import { Card, Icon } from "@the-office/ui";
import type { ReactNode } from "react";

/**
 * One block of a Task's record: its icon and title, what it can do, and its content; a region
 * named by its title.
 */
export function RecordBlock({
  icon,
  title,
  actions,
  children,
}: {
  readonly icon: string;
  readonly title: string;
  readonly actions?: ReactNode;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <section aria-label={title}>
      <Card
        title={
          <span className="task-block-title">
            <Icon name={icon} size={15} strokeWidth={1.6} />
            {title}
          </span>
        }
        actions={actions}
      >
        {children}
      </Card>
    </section>
  );
}
