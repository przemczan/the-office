import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { Button, Icon } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { taskQueries } from "../api/work.ts";
import { DocumentDialog } from "./attachments/attachment-chips.tsx";
import { ChatButton } from "./chat/chat-button.tsx";
import { AlarmButton } from "./fire-alarm/alarm-button.tsx";
import type { PageHeading } from "./page-heading.tsx";
import { onlyProjectShown } from "./project-filter/project-filter-choices.ts";
import { ProjectFilterMenu } from "./project-filter/project-filter-menu.tsx";
import { useProjectFilter } from "./project-filter/use-project-filter.ts";
import { TopBarSearch } from "./search/top-bar-search.tsx";
import { UserMenu } from "./user-menu.tsx";
import { CreateDialog } from "./work/create-dialog.tsx";

/**
 * The page's title with its crumb, the Project filter, the search, "Create", which opens one window
 * to add a Task or capture an Idea from any page, the fire alarm, the user menu (Account, Sign out),
 * and the Chat button at the end, above where the drawer opens.
 */
export function TopBar({ title, crumb, parent }: Partial<PageHeading>): ReactNode {
  const [creating, setCreating] = useState(false);
  const [reading, setReading] = useState<{ readonly id: string; readonly name: string }>();
  // On a Project's or a Task's page what is created starts in that Project, and elsewhere in the
  // one Project the filter shows, unless the user chooses otherwise.
  const { projectId, taskId } = useParams({ strict: false });
  const task = useQuery({ ...taskQueries.one(taskId ?? ""), enabled: taskId !== undefined });
  const { filter } = useProjectFilter();
  const startingProjectId = projectId ?? task.data?.projectId ?? onlyProjectShown(filter) ?? null;
  return (
    <header className="shell-top">
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
      <ProjectFilterMenu />
      <TopBarSearch onOpenDocument={setReading} />
      <Button
        variant="secondary"
        iconLeft={<Icon name="plus" size={14} />}
        aria-label="Create"
        onClick={() => setCreating(true)}
      >
        <span className="shell-top-words">Create</span>
      </Button>
      <AlarmButton />
      <UserMenu />
      <ChatButton />
      {creating && (
        <CreateDialog projectId={startingProjectId} onClose={() => setCreating(false)} />
      )}
      {reading && (
        <DocumentDialog
          document={reading}
          shownAs="markdown"
          onClose={() => setReading(undefined)}
        />
      )}
    </header>
  );
}
