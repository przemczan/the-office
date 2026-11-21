import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import {
  TASK_KINDS,
  type Idea,
  type Initiative,
  type Project,
  type Role,
  type Task,
  type TaskKind,
  type TaskSummary,
} from "@the-office/contracts";
import { Alert, Button, Icon, IconButton, Menu, SplitButton } from "@the-office/ui";
import { Link, useSearch } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { roleQueries } from "../../api/people.ts";
import { projectQueries } from "../../api/projects.ts";
import {
  attachmentQueries,
  dropIdea,
  ideaQueries,
  initiativeQueries,
  restoreIdea,
  useEveryTask,
} from "../../api/work.ts";
import { AddAttachmentDialog } from "../../shell/attachments/add-attachment-dialog.tsx";
import { AttachmentGallery } from "../../shell/attachments/attachment-gallery.tsx";
import { oneRound } from "../../shell/attachments/attachment-rounds.ts";
import { useCopyRecordLink } from "../../shell/copy-record-link.ts";
import { EmptyCard } from "../../shell/item-card.tsx";
import { InOtherProjectsNote } from "../../shell/project-filter/in-other-projects-note.tsx";
import { useProjectFilter } from "../../shell/project-filter/use-project-filter.ts";
import { ProjectChip } from "../../shell/project-chip.tsx";
import { dayAndClockOf, dayOf } from "../../shell/time.ts";
import { useToast } from "../../shell/toasts.tsx";
import { useSignedInUserId } from "../../shell/use-user-name.ts";
import { EditIdeaDialog } from "../../shell/work/edit-idea-dialog.tsx";
import { ShapeIdeaDialog, type IdeaShapeChoice } from "../../shell/work/shape-idea-dialog.tsx";
import { KindGlyph } from "../../shell/work/task-state-badge.tsx";
import { useIdeaPlanning } from "../../shell/work/use-idea-planning.ts";
import { useShaper } from "../../shell/work/use-shaper.ts";
import { usePlanner } from "../../shell/work/use-planner.ts";
import { authorName, projectIdsOfIdea } from "../../shell/work/work-words.ts";
import { RecordActions, withActionItems, type RecordAction } from "./record-actions.tsx";
import { useShaping, useShapingIntoInitiative } from "./use-shaping.ts";

/**
 * Ideas (prototypes/app/work.js): the new ones to shape or drop, and those shaped or dropped. An
 * Idea's link, as one mentioned in a chat, opens the page at it, marked.
 */
export function IdeasPage(): ReactNode {
  const ideas = useQuery(ideaQueries.list());
  const projects = useQuery(projectQueries.list());
  const roles = useQuery(roleQueries.list());
  const tasks = useEveryTask();
  const initiatives = useQuery(initiativeQueries.list());
  const linkedTo = useSearch({ from: "/work/ideas" }).idea;
  const page = useScrolledToLinked(linkedTo, ideas.data !== undefined);
  const projectFilter = useProjectFilter();
  // The Idea a link opened at shows whatever the Project filter is.
  const shown = (idea: Idea): boolean =>
    projectFilter.shows(projectIdsOfIdea(idea)) || idea.id === linkedTo;
  const inState = (state: Idea["state"]): Idea[] =>
    ideas.data?.filter((idea) => idea.state === state && shown(idea)) ?? [];
  const fresh = inState("new");
  const shaped = inState("shaped");
  const dropped = inState("dropped");
  return (
    <>
      <InOtherProjectsNote
        count={ideas.data?.filter((idea) => !shown(idea)).length ?? 0}
        one="Idea"
        many="Ideas"
      />
      <div className="ideas-page" ref={page}>
        <section className="panel">
          <h2>
            <Icon name="lightbulb" size={15} strokeWidth={1.6} />
            New <span className="panel-count">{fresh.length}</span>
          </h2>
          {ideas.error && <Alert tone="danger" title={ideas.error.message} />}
          <div className="feed">
            {fresh.map((idea) => (
              <IdeaCard
                key={idea.id}
                idea={idea}
                projects={projects.data}
                roles={roles.data}
                linkedTo={idea.id === linkedTo}
              />
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
              <ShapedIdea
                key={idea.id}
                idea={idea}
                projects={projects.data}
                tasks={tasks.data}
                initiatives={initiatives.data}
                linkedTo={idea.id === linkedTo}
              />
            ))}
            {shaped.length === 0 && <p className="ideas-none">None yet</p>}
          </div>
          <DroppedIdeas ideas={dropped} linkedTo={linkedTo} />
        </section>
      </div>
    </>
  );
}

/** Scrolls the page to the Idea its link points to, once the Ideas are read. */
function useScrolledToLinked(
  linkedTo: string | undefined,
  read: boolean,
): RefObject<HTMLDivElement | null> {
  const page = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (linkedTo === undefined || !read) return;
    page.current?.querySelector(".linked-to")?.scrollIntoView({ block: "center" });
  }, [linkedTo, read]);
  return page;
}

/** What a new Idea can become from its card: a Task in Backlog, or one planned at once. */
type IdeaAction = "shape" | "plan";

interface IdeaActionWords {
  readonly label: string;
  readonly icon: string;
  /** Takes the Project's id, and for shaping the Kind. */
  readonly mutation: UseMutationResult<Task, Error, IdeaShapeChoice>;
}

/** The Kinds the Shape split button's menu offers, each shaping a Task of that Kind. */
const SHAPE_INTO_WORDS: Readonly<Record<TaskKind, string>> = {
  feature: "Shape into a Feature Task",
  bug: "Shape into a Bug Task",
  chore: "Shape into a Chore Task",
};

function IdeaCard({
  idea,
  projects,
  roles,
  linkedTo,
}: {
  readonly idea: Idea;
  readonly projects: readonly Project[] | undefined;
  readonly roles: readonly Role[] | undefined;
  /** The page was opened at this Idea, by its link. */
  readonly linkedTo: boolean;
}): ReactNode {
  const owner = { kind: "idea", ideaId: idea.id } as const;
  const attachments = useQuery(attachmentQueries.of(owner));
  const [menuOpen, setMenuOpen] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [editing, setEditing] = useState(false);
  /** The button whose Project the user is choosing, for an Office-wide Idea. */
  const [choosingFor, setChoosingFor] = useState<IdeaAction>();
  /** The Kind the Idea is being shaped as while its Project is chosen. */
  const [shapingKind, setShapingKind] = useState<TaskKind>("feature");
  const queryClient = useQueryClient();
  const showToast = useToast();
  const planner = usePlanner();
  const copyLink = useCopyRecordLink();
  const shaping = useShaping(idea);
  const planning = useIdeaPlanning(idea);
  const shaper = useShaper();
  const signedInUserId = useSignedInUserId();
  const shapingIntoInitiative = useShapingIntoInitiative(idea);
  const actions: Readonly<Record<IdeaAction, IdeaActionWords>> = {
    shape: { label: "Shape into a Task", icon: "list-checks", mutation: shaping },
    plan: {
      label: `Plan as a Task with ${planner?.card.name ?? "whoever holds Plans"}`,
      icon: "map",
      mutation: planning,
    },
  };
  const offered: readonly IdeaAction[] = planner ? ["shape", "plan"] : ["shape"];
  const dropping = useMutation({
    mutationFn: () => dropIdea(idea.id),
    onSuccess: () => showToast(`Idea dropped: ${idea.title}.`),
    onError: (error) => showToast(error.message),
    onSettled: () => queryClient.invalidateQueries(ideaQueries.list()),
  });
  const choose = (action: IdeaAction, kind?: TaskKind): void => {
    const { mutation } = actions[action];
    setShapingKind(kind ?? "feature");
    if (idea.projectId === null) setChoosingFor(action);
    else {
      mutation.mutate(
        { projectId: idea.projectId, ...(kind && { kind }) },
        { onError: (error) => showToast(error.message) },
      );
    }
  };
  const options: RecordAction[] = [
    ...offered.map((action): RecordAction => {
      const { label, icon, mutation } = actions[action];
      return {
        key: action,
        label,
        icon,
        pending: mutation.isPending,
        onSelect: () => choose(action, action === "shape" ? "feature" : undefined),
        // One click still shapes a Feature; the arrow offers every Kind.
        ...(action === "shape" && {
          control: (
            <SplitButton
              size="sm"
              iconLeft={<Icon name={icon} size={14} />}
              loading={mutation.isPending}
              onClick={() => choose("shape", "feature")}
              menuLabel="Shape into a Task of another Kind"
              menuWidth={220}
              items={TASK_KINDS.map((kind) => ({
                label: SHAPE_INTO_WORDS[kind],
                icon: <KindGlyph kind={kind} size={14} />,
                onSelect: () => choose("shape", kind),
              }))}
            >
              {label}
            </SplitButton>
          ),
        }),
      };
    }),
    {
      key: "shape-into-initiative",
      label: shaper
        ? `Shape into an Initiative with ${shaper.card.name}`
        : "Shape into an Initiative",
      icon: "flag",
      pending: shapingIntoInitiative.isPending,
      onSelect: () => shapingIntoInitiative.mutate(),
    },
  ];
  return (
    <article
      className={`idea-card${linkedTo ? " linked-to" : ""}`}
      aria-label={idea.title}
      aria-current={linkedTo || undefined}
    >
      <div className="idea-card-head">
        <Icon name="lightbulb" size={15} />
        <span className="idea-card-title">{idea.title}</span>
        <Menu
          open={menuOpen}
          onOpenChange={setMenuOpen}
          align="end"
          width={260}
          trigger={
            <IconButton
              size="xs"
              icon={<Icon name="ellipsis" size={14} />}
              label={`More for ${idea.title}`}
            />
          }
          items={withActionItems(options, [
            {
              icon: <Icon name="pencil" size={14} />,
              label: "Edit…",
              onSelect: () => setEditing(true),
            },
            {
              icon: <Icon name="paperclip" size={14} />,
              label: "Attach…",
              onSelect: () => setAttaching(true),
            },
            {
              icon: <Icon name="link" size={14} />,
              label: "Copy link",
              onSelect: () => copyLink({ kind: "idea", ideaId: idea.id }),
            },
            { divider: true },
            {
              icon: <Icon name="x" size={14} />,
              label: "Drop",
              danger: true,
              onSelect: () => dropping.mutate(),
            },
          ])}
        />
      </div>
      <div className="idea-card-sub">
        <ProjectChip projectId={idea.projectId} projects={projects} />
        <span>
          · {capturedBy(idea, roles, signedInUserId)} · {dayAndClockOf(idea.capturedAt)}
        </span>
      </div>
      {idea.notes !== "" && <p className="idea-card-notes">{idea.notes}</p>}
      <AttachmentGallery rounds={oneRound(attachments.data ?? [])} />
      <RecordActions actions={options} size="sm" align="start" className="idea-card-options" />
      {editing && <EditIdeaDialog idea={idea} onClose={() => setEditing(false)} />}
      {attaching && (
        <AddAttachmentDialog
          owner={owner}
          ownerTitle={idea.title}
          onClose={() => setAttaching(false)}
        />
      )}
      {choosingFor && (
        <ShapeIdeaDialog
          idea={idea}
          shaping={actions[choosingFor].mutation}
          {...(choosingFor === "shape" && { kind: shapingKind })}
          actionLabel={actions[choosingFor].label}
          onClose={() => setChoosingFor(undefined)}
        />
      )}
    </article>
  );
}

function ShapedIdea({
  idea,
  projects,
  tasks,
  initiatives,
  linkedTo,
}: {
  readonly idea: Idea;
  readonly projects: readonly Project[] | undefined;
  readonly tasks: readonly TaskSummary[] | undefined;
  readonly initiatives: readonly Initiative[] | undefined;
  readonly linkedTo: boolean;
}): ReactNode {
  const task = tasks?.find(({ id }) => id === idea.taskId);
  const initiative = initiatives?.find(({ id }) => id === idea.initiativeId);
  return (
    <div
      className={`ideas-row${linkedTo ? " linked-to" : ""}`}
      aria-current={linkedTo || undefined}
    >
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
          {initiative && (
            <span>
              · became{" "}
              <Link
                to="/work/initiatives/$initiativeId"
                params={{ initiativeId: initiative.id }}
                className="ideas-task-link"
              >
                <Icon name="flag" size={12} />
                {initiative.name}
              </Link>
            </span>
          )}
        </div>
      </div>
      <span className="ideas-row-time">{dayOf(idea.capturedAt)}</span>
    </div>
  );
}

function DroppedIdeas({
  ideas,
  linkedTo,
}: {
  readonly ideas: readonly Idea[];
  readonly linkedTo: string | undefined;
}): ReactNode {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const restoring = useMutation({
    mutationFn: (idea: Idea) => restoreIdea(idea.id),
    onSuccess: (idea) => showToast(`${idea.title} is back among the new Ideas.`),
    onError: (error) => showToast(error.message),
    onSettled: () => queryClient.invalidateQueries(ideaQueries.list()),
  });
  return (
    <details className="ideas-dropped" open={ideas.some(({ id }) => id === linkedTo) || undefined}>
      <summary>
        <Icon name="archive" size={14} />
        Dropped · {ideas.length}
      </summary>
      {ideas.map((idea) => (
        <div
          key={idea.id}
          className={`ideas-dropped-row${idea.id === linkedTo ? " linked-to" : ""}`}
          aria-current={idea.id === linkedTo || undefined}
        >
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

function capturedBy(
  idea: Idea,
  roles: readonly Role[] | undefined,
  signedInUserId: string | undefined,
): string {
  return `${authorName(idea.capturedBy, roles, signedInUserId)} captured it`;
}
