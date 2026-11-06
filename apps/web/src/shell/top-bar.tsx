import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { Button, Icon, Logo } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { taskQueries } from "../api/work.ts";
import { DocumentDialog } from "./attachments/attachment-chips.tsx";
import { useBrandTone } from "./brand-tone.ts";
import { ChatButton } from "./chat/chat-button.tsx";
import { AlarmButton } from "./fire-alarm/alarm-button.tsx";
import type { PageHeading } from "./page-heading.tsx";
import { onlyProjectShown } from "./project-filter/project-filter-choices.ts";
import { ProjectFilterMenu } from "./project-filter/project-filter-menu.tsx";
import { useProjectFilter } from "./project-filter/use-project-filter.ts";
import { TopBarSearch } from "./search/top-bar-search.tsx";
import { CaptureIdeaDialog } from "./work/capture-idea-dialog.tsx";

/**
 * The lockup, the page's title with its crumb, the Project filter, the search, "Idea", which
 * captures one from any page, the fire alarm, and the Chat button at the end, above where the
 * drawer opens.
 */
export function TopBar({ title, crumb, parent }: Partial<PageHeading>): ReactNode {
  const [capturing, setCapturing] = useState(false);
  const [reading, setReading] = useState<{ readonly id: string; readonly name: string }>();
  // On a Project's or a Task's page an Idea is captured in that Project, and elsewhere in the one
  // Project the filter shows, unless the user chooses otherwise.
  const { projectId, taskId } = useParams({ strict: false });
  const task = useQuery({ ...taskQueries.one(taskId ?? ""), enabled: taskId !== undefined });
  const { filter } = useProjectFilter();
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
      <ProjectFilterMenu />
      <TopBarSearch onOpenDocument={setReading} />
      <Button
        variant="secondary"
        iconLeft={<Icon name="plus" size={14} />}
        aria-label="Idea"
        onClick={() => setCapturing(true)}
      >
        <span className="shell-top-words">Idea</span>
      </Button>
      <AlarmButton />
      <ChatButton />
      {capturing && (
        <CaptureIdeaDialog
          projectId={projectId ?? task.data?.projectId ?? onlyProjectShown(filter) ?? null}
          onClose={() => setCapturing(false)}
        />
      )}
      {reading && <DocumentDialog document={reading} onClose={() => setReading(undefined)} />}
    </header>
  );
}
