import { Link } from "@tanstack/react-router";
import { Button, Icon, Logo } from "@the-office/ui";
import type { ReactNode } from "react";
import { useBrandTone } from "./brand-tone.ts";
import type { PageHeading } from "./page-heading.tsx";

/**
 * The lockup, the page's title with its crumb, and "Idea", which opens the Idea capture from task
 * 10 on.
 */
export function TopBar({ title, crumb, parent }: Partial<PageHeading>): ReactNode {
  return (
    <header className="shell-top">
      <span className="shell-top-lockup">
        <Logo size={20} product="The Office" tone={useBrandTone()} />
      </span>
      <span className="shell-top-divider" />
      <h1>{title}</h1>
      {(crumb !== undefined || parent !== undefined) && (
        <span className="shell-top-crumb">
          {parent && (
            <>
              <Link to={parent.to}>{parent.label}</Link>
              {" › "}
            </>
          )}
          {crumb}
        </span>
      )}
      <span className="shell-grow" />
      <Button variant="secondary" iconLeft={<Icon name="plus" size={14} />}>
        Idea
      </Button>
    </header>
  );
}
