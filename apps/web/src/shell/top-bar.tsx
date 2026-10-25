import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { Button, Icon, Logo } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { taskQueries } from "../api/work.ts";
import { useBrandTone } from "./brand-tone.ts";
import type { PageHeading } from "./page-heading.tsx";
import { CaptureIdeaDialog } from "./work/capture-idea-dialog.tsx";

/** The lockup, the page's title with its crumb, and "Idea", which captures one from any page. */
export function TopBar({ title, crumb, parent }: Partial<PageHeading>): ReactNode {
  const [capturing, setCapturing] = useState(false);
  // On a Project's or a Task's page an Idea is captured in that Project unless the user chooses
  // otherwise.
  const { projectId, taskId } = useParams({ strict: false });
  const task = useQuery({ ...taskQueries.one(taskId ?? ""), enabled: taskId !== undefined });
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
      <Button
        variant="secondary"
        iconLeft={<Icon name="plus" size={14} />}
        onClick={() => setCapturing(true)}
      >
        Idea
      </Button>
      {capturing && (
        <CaptureIdeaDialog
          projectId={projectId ?? task.data?.projectId ?? null}
          onClose={() => setCapturing(false)}
        />
      )}
    </header>
  );
}
