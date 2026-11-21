import { Card, Icon } from "@the-office/ui";
import type { ReactNode } from "react";

/** One block of a Project's page: a card with an icon in its title and a quiet note under it. */
export function ProjectBlock({
  icon,
  title,
  actions,
  note,
  anchor,
  children,
}: {
  readonly icon: string;
  readonly title: string;
  /** Beside the title, such as a status badge. */
  readonly actions?: ReactNode;
  readonly note?: string;
  /** The id a link to this block names as its hash, on its title. */
  readonly anchor?: string;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <Card
      title={
        <span className="project-block-title" id={anchor}>
          <Icon name={icon} size={15} strokeWidth={1.6} />
          {title}
        </span>
      }
      actions={actions}
    >
      {children}
      {note !== undefined && <p className="project-block-note">{note}</p>}
    </Card>
  );
}
