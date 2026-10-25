import { Card, Icon } from "@the-office/ui";
import type { ReactNode } from "react";

/** One block of a Project's page: a card with an icon in its title and a quiet note under it. */
export function ProjectBlock({
  icon,
  title,
  note,
  children,
}: {
  readonly icon: string;
  readonly title: string;
  readonly note?: string;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <Card
      title={
        <span className="project-block-title">
          <Icon name={icon} size={15} strokeWidth={1.6} />
          {title}
        </span>
      }
    >
      {children}
      {note !== undefined && <p className="project-block-note">{note}</p>}
    </Card>
  );
}
