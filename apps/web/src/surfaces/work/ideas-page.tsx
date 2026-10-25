import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Idea, Project, Role, Task } from "@the-office/contracts";
import { Alert, Button, Icon, IconButton, Menu } from "@the-office/ui";
import { Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { roleQueries } from "../../api/people.ts";
import { projectQueries } from "../../api/projects.ts";
import {
  attachmentQueries,
  dropIdea,
  ideaQueries,
  restoreIdea,
  taskQueries,
} from "../../api/work.ts";
import { AddAttachmentDialog } from "../../shell/attachments/add-attachment-dialog.tsx";
import { AttachmentChips } from "../../shell/attachments/attachment-chips.tsx";
import { EmptyCard } from "../../shell/item-card.tsx";
import { ProjectChip } from "../../shell/project-chip.tsx";
import { dayAndClockOf, dayOf } from "../../shell/time.ts";
import { useToast } from "../../shell/toasts.tsx";
import { authorName } from "../../shell/work/work-words.ts";
import { ShapeIdeaDialog } from "./shape-idea-dialog.tsx";
import { useShaping } from "./use-shaping.ts";

/** Ideas (prototypes/app/work.js): the new ones to shape or drop, and those shaped or dropped. */
export function IdeasPage(): ReactNode {
  const ideas = useQuery(ideaQueries.list());
  const projects = useQuery(projectQueries.list());
  const roles = useQuery(roleQueries.list());
  const tasks = useQuery(taskQueries.list());
  const inState = (state: Idea["state"]): Idea[] =>
    ideas.data?.filter((idea) => idea.state === state) ?? [];
  const fresh = inState("new");
  const shaped = inState("shaped");
  const dropped = inState("dropped");
  return (
    <div className="ideas-page">
      <section className="panel">
        <h2>
          <Icon name="lightbulb" size={15} strokeWidth={1.6} />
          New <span className="panel-count">{fresh.length}</span>
        </h2>
        {ideas.error && <Alert tone="danger" title={ideas.error.message} />}
        <div className="feed">
          {fresh.map((idea) => (
            <IdeaCard key={idea.id} idea={idea} projects={projects.data} roles={roles.data} />
          ))}
          {ideas.data && fresh.length === 0 && (
            <EmptyCard>No new Ideas. Capture one with "Idea" in the top bar.</EmptyCard>
          )}
        </div>
      </section>
      <section className="panel">
        <h2>
          <Icon name="check" size={15} strokeWidth={1.6} />
          Shaped <span className="panel-count">{shaped.length}</span>
        </h2>
        <div className="ideas-shaped">
          {shaped.map((idea) => (
            <ShapedIdea key={idea.id} idea={idea} projects={projects.data} tasks={tasks.data} />
          ))}
          {shaped.length === 0 && <p className="ideas-none">None yet</p>}
        </div>
        <DroppedIdeas ideas={dropped} />
      </section>
    </div>
  );
}

function IdeaCard({
  idea,
  projects,
  roles,
}: {
  readonly idea: Idea;
  readonly projects: readonly Project[] | undefined;
  readonly roles: readonly Role[] | undefined;
}): ReactNode {
  const owner = { kind: "idea", ideaId: idea.id } as const;
  const attachments = useQuery(attachmentQueries.of(owner));
  const [menuOpen, setMenuOpen] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [choosingProject, setChoosingProject] = useState(false);
  const queryClient = useQueryClient();
  const showToast = useToast();
  const shaping = useShaping(idea);
  const dropping = useMutation({
    mutationFn: () => dropIdea(idea.id),
    onSuccess: () => showToast(`Idea dropped: ${idea.title}.`),
    onError: (error) => showToast(error.message),
    onSettled: () => queryClient.invalidateQueries(ideaQueries.list()),
  });
  return (
    <article className="idea-card" aria-label={idea.title}>
      <div className="idea-card-head">
        <Icon name="lightbulb" size={15} />
        <span className="idea-card-title">{idea.title}</span>
        <Menu
          open={menuOpen}
          onOpenChange={setMenuOpen}
          align="end"
          width={180}
          trigger={
            <IconButton
              size="xs"
              icon={<Icon name="ellipsis" size={14} />}
              label={`More for ${idea.title}`}
            />
          }
          items={[
            {
              icon: <Icon name="paperclip" size={14} />,
              label: "Attach…",
              onSelect: () => setAttaching(true),
            },
            { divider: true },
            {
              icon: <Icon name="x" size={14} />,
              label: "Drop",
              danger: true,
              onSelect: () => dropping.mutate(),
            },
          ]}
        />
      </div>
      <div className="idea-card-sub">
        <ProjectChip projectId={idea.projectId} projects={projects} />
        <span>
          · {capturedBy(idea, roles)} · {dayAndClockOf(idea.capturedAt)}
        </span>
      </div>
      {idea.notes !== "" && <p className="idea-card-notes">{idea.notes}</p>}
      <AttachmentChips attachments={attachments.data ?? []} />
      <div className="idea-card-options">
        <Button
          variant="secondary"
          size="sm"
          iconLeft={<Icon name="list-checks" size={14} />}
          loading={shaping.isPending}
          onClick={() => {
            if (idea.projectId === null) setChoosingProject(true);
            else shaping.mutate(idea.projectId, { onError: (error) => showToast(error.message) });
          }}
        >
          Shape into a Task
        </Button>
      </div>
      {attaching && (
        <AddAttachmentDialog
          owner={owner}
          ownerTitle={idea.title}
          onClose={() => setAttaching(false)}
        />
      )}
      {choosingProject && <ShapeIdeaDialog idea={idea} onClose={() => setChoosingProject(false)} />}
    </article>
  );
}

function ShapedIdea({
  idea,
  projects,
  tasks,
}: {
  readonly idea: Idea;
  readonly projects: readonly Project[] | undefined;
  readonly tasks: readonly Task[] | undefined;
}): ReactNode {
  const task = tasks?.find(({ id }) => id === idea.taskId);
  return (
    <div className="ideas-row">
      <div className="ideas-row-grow">
        <div className="ideas-row-title">{idea.title}</div>
        <div className="ideas-row-sub">
          <ProjectChip projectId={idea.projectId} projects={projects} />
          {task && (
            <span>
              · became{" "}
              <Link to="/tasks/$taskId" params={{ taskId: task.id }} className="ideas-task-link">
                <Icon name="list-checks" size={12} />
                {task.title}
              </Link>
            </span>
          )}
        </div>
      </div>
      <span className="ideas-row-time">{dayOf(idea.capturedAt)}</span>
    </div>
  );
}

function DroppedIdeas({ ideas }: { readonly ideas: readonly Idea[] }): ReactNode {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const restoring = useMutation({
    mutationFn: (idea: Idea) => restoreIdea(idea.id),
    onSuccess: (idea) => showToast(`${idea.title} is back among the new Ideas.`),
    onError: (error) => showToast(error.message),
    onSettled: () => queryClient.invalidateQueries(ideaQueries.list()),
  });
  return (
    <details className="ideas-dropped">
      <summary>
        <Icon name="archive" size={14} />
        Dropped · {ideas.length}
      </summary>
      {ideas.map((idea) => (
        <div key={idea.id} className="ideas-dropped-row">
          <span className="ideas-row-grow">{idea.title}</span>
          {idea.droppedAt !== null && (
            <span className="ideas-row-time">dropped {dayOf(idea.droppedAt)}</span>
          )}
          <Button size="sm" variant="secondary" onClick={() => restoring.mutate(idea)}>
            Restore
          </Button>
        </div>
      ))}
    </details>
  );
}

function capturedBy(idea: Idea, roles: readonly Role[] | undefined): string {
  return `${authorName(idea.capturedBy, roles)} captured it`;
}
