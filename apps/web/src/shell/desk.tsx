import { Link, type LinkProps } from "@tanstack/react-router";
import { Icon } from "@the-office/ui";
import type { ReactNode } from "react";

/** A page's panels: three filling the width, folding to two, then one. */
export function Desk({ children }: { readonly children: ReactNode }): ReactNode {
  return <div className="desk">{children}</div>;
}

export interface PanelHeadingProps {
  readonly icon: string;
  readonly title: string;
  /** A link at the heading's end, such as "Open Work". */
  readonly action?: { readonly label: string; readonly to: NonNullable<LinkProps["to"]> };
}

export function Panel({ children }: { readonly children: ReactNode }): ReactNode {
  return <section className="panel">{children}</section>;
}

export function PanelHeading({ icon, title, action }: PanelHeadingProps): ReactNode {
  return (
    <h2>
      <Icon name={icon} size={15} strokeWidth={1.6} />
      {title}
      {action && (
        <Link to={action.to} className="panel-action">
          {action.label}
        </Link>
      )}
    </h2>
  );
}

/** A panel's items, a card each. */
export function Feed({ children }: { readonly children: ReactNode }): ReactNode {
  return <div className="feed">{children}</div>;
}
